import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { Agent, Phase, RateLimit, SessionInfo } from '../types'

const NAME = 'subagent-monitor'
const PANE = 'subagents'
const TITLE = 'Subagents'
const KEEP = 30 // so viele Agenten bleiben in der Liste
const TICK_MS = 1000
const POLL_MS = 3000

// Tag ändern, wenn sich die Felder von Agent ändern: alte gespeicherte Werte werden dann verworfen.
const agents = atom({ plugin: 'subagent-monitor', key: 'agents' } as const, [], { shape: 'agents-1' })
const now = atom({ plugin: 'subagent-monitor', key: 'now' } as const, 0)
const limits = atom({ plugin: 'subagent-monitor', key: 'limits' } as const, [], { shape: 'limits-1' })
const session = atom({ plugin: 'subagent-monitor', key: 'session' } as const, null, { shape: 'session-1' })
const warm = atom({ plugin: 'subagent-monitor', key: 'warm' } as const, { on: false, lastRequestAt: 0, pings: 0 }, { shape: 'warm-1' })

// Cache lebt 60 min ab der letzten Anfrage: nach 50 min Ruhe einmal pingen.
const WARM_AFTER_MS = 50 * 60_000
// Sicherung gegen Dauerlauf (z. B. über Nacht): nach so vielen Pings in Folge schaltet es sich aus.
const MAX_PINGS = 5
const PING_PROMPT = 'Cache-Ping. Antworte nur mit: OK'
let pinging = false

const IDLE_TICK_MS = 30_000
const BAR_COLOR = '#2f6fd0'
const BAR_WARN = '#d08a2f'
const BAR_FULL = '#d0402f'
const LIMIT_LABEL: Record<string, string> = {
  five_hour: 'Session (5h)',
  seven_day: 'Woche (7 Tage)',
  spend_limit: 'Ausgabenlimit',
}

// Modulvariablen beginnen bei jedem Neuladen von vorn; session.start startet die Uhr wieder.
let ticker: { cancel(): void } | null = null
let tickerMs = 0
let ticks = 0

const MS = 1000
function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / MS))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** 950 → „950“, 41 984 → „42k“, 1 234 567 → „1,23 M“ */
function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(2).replace('.', ',')} M`
}

/** Eingabe einer Anfrage samt Cache: so groß war der Kontext, den das Modell gelesen hat. */
function contextOf(u: TurnUsage): number {
  return u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
}

function contextFields(c: { tokens?: number; window: number; percent?: number }): Partial<SessionInfo> {
  return {
    contextWindow: c.window,
    ...(c.tokens !== undefined ? { contextTokens: c.tokens } : {}),
    ...(c.percent !== undefined ? { contextPercent: c.percent } : {}),
  }
}

function clockText(at: number, withDate: boolean): string {
  try {
    const date: Intl.DateTimeFormatOptions = withDate ? { weekday: 'short', day: 'numeric', month: 'numeric' } : {}
    return new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', ...date, hour: '2-digit', minute: '2-digit' }).format(at)
  } catch {
    return ''
  }
}

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

/** Woran der Agent arbeitet: das Ziel des Werkzeugaufrufs in wenigen Worten. */
function describe(tool: string, a: Record<string, unknown>): string {
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return basename(s('file_path') || s('notebook_path'))
    case 'Bash':
    case 'PowerShell':
      return s('description') || s('command')
    case 'Grep':
      return s('pattern') + (s('path') ? ` in ${basename(s('path'))}` : '')
    case 'Glob':
      return s('pattern')
    case 'WebFetch':
      return s('url')
    case 'WebSearch':
      return s('query')
    case 'Agent':
      return s('description')
    default:
      return s('description') || s('prompt').slice(0, 80)
  }
}

function shortModel(m: string): string {
  const hit = /(opus|sonnet|haiku|fable)/i.exec(m)
  return hit ? hit[1]!.toLowerCase() : m
}

/** „in 2 h 14 min · So 8.11. 13:00“; die Uhrzeit in Wiener Zeit, falls die Umgebung Zeitzonen kennt. */
function resetText(iso: string | undefined, t: number, withDate: boolean): string {
  if (!iso) return ''
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const min = Math.max(0, Math.round((at - t) / 60_000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const rel = d ? `in ${d}d ${h}h` : h ? `in ${h}h ${m}min` : `in ${m}min`
  const abs = clockText(at, withDate)
  return abs ? `${rel} · ${abs}` : rel
}

function barSvg(pct: number, px: number): string {
  const w = Math.max(0, Math.min(100, pct))
  const color = w >= 90 ? BAR_FULL : w >= 70 ? BAR_WARN : BAR_COLOR
  const fill = Math.round((px * w) / 100)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="6" viewBox="0 0 ${px} 6">` +
    `<rect width="${px}" height="6" rx="3" fill="#8884"/>` +
    (fill ? `<rect width="${Math.max(fill, 6)}" height="6" rx="3" fill="${color}"/>` : '') +
    `</svg>`
  )
}

function copyLimit(l: RateLimit): RateLimit {
  return l.resetsAt ? { kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt } : { kind: l.kind, percentUsed: l.percentUsed }
}

function barText(pct: number, cols: number): string {
  const n = Math.round((Math.max(0, Math.min(100, pct)) / 100) * cols)
  return '█'.repeat(n) + '░'.repeat(cols - n)
}

async function anyRunning($: EngineInterface): Promise<boolean> {
  return (await read($, agents)).some(a => a.phase === 'running')
}

/**
 * Solange ein Agent arbeitet: jede Sekunde neu zeichnen, alle 3 s Status abgleichen.
 * Sonst alle 30 s, damit der Countdown bis zum Zurücksetzen der Limits weiterläuft.
 */
async function syncClock($: EngineInterface) {
  const running = await anyRunning($)
  const want = running ? TICK_MS : IDLE_TICK_MS
  if (ticker && tickerMs !== want) {
    ticker.cancel()
    ticker = null
  }
  tickerMs = want
  ticker ??= $.clock.every(want, () => {
    void tick($, running).catch(() => undefined)
  })
  const t = await $.clock.now()
  await update($, now, () => t)
}

async function tick($: EngineInterface, running: boolean) {
  const t = await $.clock.now()
  await update($, now, () => t)
  ticks++
  if (running && ticks % (POLL_MS / TICK_MS) === 0) await poll($)
  await checkWarm($, t)
}

/** Schickt den Ping, wenn Warmhalten an ist und der Hauptchat seit 50 min still war. */
async function checkWarm($: EngineInterface, t: number) {
  const w = await read($, warm)
  if (!w.on || pinging || t - w.lastRequestAt < WARM_AFTER_MS) return
  pinging = true
  try {
    // Fork: der Chatverlauf wie zuletzt gesendet plus eine Zeile, ohne Werkzeuge und
    // unsichtbar im Chat. Er liest den Cache und setzt dessen 60 min neu.
    const r = await $.model.fork({ prompt: PING_PROMPT })
    const ok = r.isAnswered
    const at = await $.clock.now()
    await update($, warm, v => {
      const pings = v.pings + 1
      // Fehlgeschlagen: in 2 min noch einmal versuchen, solange der Cache noch lebt.
      const lastRequestAt = ok ? at : v.lastRequestAt + 2 * 60_000
      return { ...v, on: v.on && pings < MAX_PINGS, lastRequestAt, pings, lastPingAt: at, lastPingOk: ok }
    })
  } finally {
    pinging = false
  }
}

/** Abgleich mit der Agentenliste der Engine: fängt Abbrüche und verpasste Enden ab. */
async function poll($: EngineInterface) {
  const live = new Map((await $.agent.list()).map(a => [a.id, a.status]))
  const t = await $.clock.now()
  let changed = false
  await update($, agents, list =>
    list.map(a => {
      if (a.phase !== 'running') return a
      const st = live.get(a.id)
      const phase: Phase | null =
        st === 'completed' || st === 'idle' ? 'done' : st === 'failed' || st === 'killed' ? 'failed' : null
      if (!phase) return a
      changed = true
      return { ...a, phase, endedAt: t }
    }),
  )
  if (changed) await syncClock($)
}

async function finish($: EngineInterface, id: string, phase: Phase) {
  const t = await $.clock.now()
  await update($, agents, list =>
    list.map(a => (a.id === id && a.phase === 'running' ? { ...a, phase, endedAt: t } : a)),
  )
  await syncClock($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'subagents', description: 'Subagent-Monitor öffnen' })
    await syncClock($)
    const r = await next(e)
    try {
      const u = await $.session.usage()
      if (u.rateLimits.length) await update($, limits, () => u.rateLimits.map(copyLimit))
      const t = await $.clock.now()
      await update($, session, s => ({
        ...(s ?? { input: 0, cacheRead: 0, output: 0, countingSince: t }),
        startedAt: u.startedAt,
        ...contextFields(u.context),
        ...(u.cost ? { usd: u.cost.usd } : {}),
      }))
    } catch {
      // ohne Abo oder vor der ersten Antwort: keine Limits, der Bereich bleibt weg
    }
    return r
  })

  // Nach jeder Antwort und wenn ein Limit um einen ganzen Prozentpunkt wandert.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, limits, () => e.rateLimits.map(copyLimit))
    const t = await $.clock.now()
    await update($, session, s => ({
      ...(s ?? { input: 0, cacheRead: 0, output: 0, countingSince: t }),
      ...contextFields(e.context),
      ...(e.cost ? { usd: e.cost.usd } : {}),
    }))
    return next(e)
  })

  on('command.run', { command: 'subagents' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Subagent-Monitor geöffnet.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const id = r.agentId
    if (!id) return r
    const agent: Agent = {
      id,
      description: e.description || 'Subagent',
      type: e.subagentType || 'subagent',
      model: shortModel(r.model ?? ''),
      startedAt: await $.clock.now(),
      phase: 'running',
      steps: 0,
    }
    await update($, agents, list => [...list.filter(a => a.id !== id), agent].slice(-KEEP))
    await syncClock($)
    void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return r
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const tool = e.tool as string
      const detail = describe(tool, e as unknown as Record<string, unknown>)
      await update($, agents, list =>
        list.map(a => (a.id === id ? { ...a, tool, detail, steps: a.steps + 1 } : a)),
      )
    }
    return next(e)
  })

  // Jede Modellanfrage: Kontext und Ausgabe je Subagent, Summen für die ganze Sitzung.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r.usage
    if (u) {
      const id = e.agentId
      const ctx = contextOf(u)
      if (id) {
        await update($, agents, list =>
          list.map(a => (a.id === id ? { ...a, context: ctx, output: (a.output ?? 0) + u.output_tokens } : a)),
        )
      }
      const t = await $.clock.now()
      // Eine echte Anfrage des Hauptchats hat den Cache gerade erneuert: Ping-Uhr und Zähler von vorn.
      if (!id) await update($, warm, v => ({ ...v, lastRequestAt: t, pings: 0 }))
      await update($, session, s => {
        const base = s ?? { input: 0, cacheRead: 0, output: 0, countingSince: t }
        return {
          ...base,
          ...(id ? {} : { contextTokens: ctx }),
          input: base.input + ctx,
          cacheRead: base.cacheRead + u.cache_read_input_tokens,
          output: base.output + u.output_tokens,
        }
      })
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) {
      const failed = e.reason === 'error' || e.reason === 'refusal' || e.isAborted
      await finish($, e.agentId, failed ? 'failed' : 'done')
    }
    return r
  })

  on('ui.press', { plugin: NAME, element: 'warm' }, async ($, e, next) => {
    const t = await $.clock.now()
    // Beim Einschalten zählt die Ruhe ab jetzt, falls noch keine Anfrage gesehen wurde.
    await update($, warm, v => ({ ...v, on: !v.on, pings: 0, lastRequestAt: v.lastRequestAt || t }))
    return next(e)
  })

  on('ui.press', { plugin: NAME, element: 'clear' }, async ($, e, next) => {
    await update($, agents, list => list.filter(a => a.phase === 'running'))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const list = await read($, agents)
    // Vor dem ersten Takt steht die Uhr auf 0: dann die echte Zeit nehmen.
    const t = (await read($, now)) || (await $.clock.now())
    const running = list.filter(a => a.phase === 'running')
    const ended = list.filter(a => a.phase !== 'running').reverse()

    const row = (a: Agent) => {
      const live = a.phase === 'running'
      const mark = live ? '●' : a.phase === 'done' ? '✓' : '✗'
      const markColor = live ? 'warning' : a.phase === 'done' ? 'success' : 'error'
      const time = duration((live ? Math.max(t, a.startedAt) : (a.endedAt ?? a.startedAt)) - a.startedAt)
      const who = [a.type, a.model].filter(Boolean).join(' · ')
      const doing = live
        ? a.tool
          ? `${a.tool}: ${a.detail || '…'}`
          : 'startet …'
        : `${a.phase === 'done' ? 'fertig' : 'abgebrochen'} · ${a.steps} Schritte`
      return (
        <Box key={a.id} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={markColor}>{mark}</Text>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text bold={live} dimColor={!live} wrap="truncate-end">
                {a.description}
              </Text>
            </Box>
            <Text dimColor={!live}>{time}</Text>
          </Box>
          <Box paddingLeft={2} flexDirection="column">
            <Text dimColor wrap="truncate-end">{who}</Text>
            <Text dimColor={!live} wrap="truncate-end">{doing}</Text>
            {a.context !== undefined ? (
              <Text dimColor wrap="truncate-end">{`Kontext ${tokens(a.context)} · Ausgabe ${tokens(a.output ?? 0)} Tokens`}</Text>
            ) : null}
          </Box>
        </Box>
      )
    }

    const windows = await read($, limits)
    const cols = e.props.bodyColumns
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const limit = (l: RateLimit) => {
      const pct = l.percentUsed
      const label = LIMIT_LABEL[l.kind] ?? l.kind
      // Das 5-h-Fenster endet immer heute oder morgen früh: Uhrzeit reicht.
      const reset = resetText(l.resetsAt, t, l.kind !== 'five_hour')
      return (
        <Box key={`limit-${l.kind}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" gap={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text>{label}</Text>
            </Box>
            <Text bold>{`${Math.round(pct)} %`}</Text>
          </Box>
          {bar(pct, label)}
          {reset ? <Text dimColor wrap="truncate-end">{`reset ${reset}`}</Text> : null}
        </Box>
      )
    }

    const bar = (pct: number, label: string) =>
      Svg ? (
        <Svg source={barSvg(pct, Math.max(80, Math.floor(cols * 6.5)))} alt={`${label}: ${Math.round(pct)} %`} height={6} />
      ) : (
        <Text color={pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'suggestion'}>{barText(pct, Math.max(10, cols - 2))}</Text>
      )

    const pair = (key: string, label: string, value: string) => (
      <Box key={key} flexDirection="row" gap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text dimColor wrap="truncate-end">{label}</Text>
        </Box>
        <Text>{value}</Text>
      </Box>
    )

    const s = await read($, session)
    const ctxPct =
      s?.contextTokens !== undefined && s.contextWindow ? (100 * s.contextTokens) / s.contextWindow : s?.contextPercent
    const info = s ? (
      <Box flexDirection="column">
        <Text bold>Sitzung</Text>
        {s.startedAt !== undefined ? pair('started', 'Gestartet', clockText(s.startedAt, true)) : null}
        {s.contextTokens !== undefined
          ? pair(
              'ctx',
              'Kontext',
              `${tokens(s.contextTokens)}${s.contextWindow ? ` von ${tokens(s.contextWindow)}` : ''}${ctxPct !== undefined ? ` (${Math.round(ctxPct)} %)` : ''}`,
            )
          : null}
        {ctxPct !== undefined ? bar(ctxPct, 'Kontext') : null}
        {pair('in', 'Eingabe gesamt', `${tokens(s.input)} (Cache ${tokens(s.cacheRead)})`)}
        {pair('out', 'Ausgabe gesamt', tokens(s.output))}
      </Box>
    ) : null

    const w = await read($, warm)
    const last =
      w.lastPingAt !== undefined ? `letzter Ping ${clockText(w.lastPingAt, false)} ${w.lastPingOk ? '✓' : '✗'}` : ''
    const nextIn = Math.max(0, Math.ceil((w.lastRequestAt + WARM_AFTER_MS - t) / 60_000))
    const warmText = w.on
      ? [`nächster Ping in ${nextIn}min`, `${w.pings}/${MAX_PINGS}`, last].filter(Boolean).join(' · ')
      : last

    // Mindestens so hoch wie das Panel, damit die Liste wächst und Sitzung und Limits unten stehen.
    const minHeight = e.props.scroll.bodyRows

    return (
      <Box flexDirection="column" minHeight={minHeight}>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {list.length === 0 ?<Text dimColor>Noch keine Subagents in dieser Sitzung.</Text> : null}
        {running.length ? <Text bold>{`Laufend (${running.length})`}</Text> : null}
        {running.map(row)}
        {ended.length ? (
          <Box flexDirection="row" gap={1}>
            <Text bold>{`Beendet (${ended.length})`}</Text>
            <Button key="clear" plain onPress={() => undefined}>
              <Text dimColor>leeren</Text>
            </Button>
          </Box>
        ) : null}
        {ended.map(row)}
        </Box>
        {info || windows.length ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor wrap="truncate-end">{'─'.repeat(Math.max(10, cols))}</Text>
            {info}
            {windows.length ? (
              <Box flexDirection="column" marginTop={info ? 1 : 0}>
                <Text bold>Nutzungslimits</Text>
                {windows.map(limit)}
              </Box>
            ) : null}
            <Box flexDirection="column" marginTop={1}>
              <Box flexDirection="row" gap={1}>
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text>Cache warmhalten</Text>
                </Box>
                <Button key="warm" variant={w.on ? 'primary' : 'secondary'} onPress={() => undefined}>
                  {w.on ? 'an' : 'aus'}
                </Button>
              </Box>
              {warmText ? <Text dimColor wrap="truncate-end">{warmText}</Text> : null}
            </Box>
          </Box>
        ) : null}
      </Box>
    )
  })
}
