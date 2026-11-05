import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { Agent, Lang, Phase, RateLimit, SessionInfo } from '../types'

const NAME = 'agent-deck'
const PANE = 'agentdeck'
const TITLE = 'Agent Deck'
const KEEP = 30 // agents kept in the list
const HISTORY = 30 // steps kept per agent
const TICK_MS = 1000
const POLL_MS = 3000

// Change a shape tag when that value's fields change: values an earlier version stored are then dropped.
const agents = atom({ plugin: 'agent-deck', key: 'agents' } as const, [], { shape: 'agents-1' })
const now = atom({ plugin: 'agent-deck', key: 'now' } as const, 0)
const limits = atom({ plugin: 'agent-deck', key: 'limits' } as const, [], { shape: 'limits-1' })
const session = atom({ plugin: 'agent-deck', key: 'session' } as const, null, { shape: 'session-1' })
const warm = atom({ plugin: 'agent-deck', key: 'warm' } as const, { on: false, lastRequestAt: 0, pings: 0 }, { shape: 'warm-1' })
const open = atom({ plugin: 'agent-deck', key: 'open' } as const, [], { shape: 'open-1' })

// The prompt cache lives 60 min after the last request: ping once after 50 min of quiet.
const WARM_AFTER_MS = 50 * 60_000
// Guard against running all night: after this many pings in a row it switches itself off.
const MAX_PINGS = 5
const PING_PROMPT = 'Cache ping. Reply only with: OK'
let pinging = false

const IDLE_TICK_MS = 30_000
const GREEN = '#2e9e44'
const YELLOW = '#d6b400'
const ORANGE = '#e08a1e'
const RED = '#d0402f'

/** Limit bars: green up to 40 %, yellow to 60 %, orange to 80 %, red above. */
function limitColor(pct: number): string {
  return pct <= 40 ? GREEN : pct <= 60 ? YELLOW : pct <= 80 ? ORANGE : RED
}

/**
 * Context bar by share of the model's window, so it fits every model: green up to 25 %,
 * yellow to 50 %, orange to 75 %, red above (on a 1M window: 250k / 500k / 750k).
 * Answers get worse as the context fills, long before the window is full.
 */
function contextColor(pct: number): string {
  return pct <= 25 ? GREEN : pct <= 50 ? YELLOW : pct <= 75 ? ORANGE : RED
}

// Every text the pane shows, per language.
const TEXT = {
  de: {
    locale: 'de-AT',
    command: 'Agent Deck öffnen',
    opened: 'Agent Deck geöffnet.',
    none: 'Noch keine Subagents in dieser Sitzung.',
    running: 'Laufend',
    ended: 'Beendet',
    clear: 'leeren',
    starting: 'startet …',
    aborted: 'abgebrochen',
    steps: 'Schritte',
    step: 'Schritt',
    tokens: 'T.',
    working: 'arbeitet',
    earlier: 'frühere Schritte',
    stop: 'Stopp',
    session: 'Sitzung',
    started: 'Gestartet',
    context: 'Kontext',
    of: 'von',
    used: 'Tokenverbrauch',
    limits: 'Nutzungslimits',
    five_hour: 'Session (5h)',
    seven_day: 'Woche (7 Tage)',
    spend_limit: 'Ausgabenlimit',
    reset: 'Reset',
    warm: 'Cache warmhalten',
    on: 'An',
    off: 'Aus',
    turnOn: 'Einschalten',
    turnOff: 'Ausschalten',
    nextPing: 'nächster Ping in',
    lastPing: 'letzter Ping',
    fromCache: 'aus dem Cache',
    cold: 'Cache war kalt, neu geschrieben:',
    noReply: 'keine Antwort',
  },
  en: {
    locale: 'en-GB',
    command: 'Open the Agent Deck',
    opened: 'Agent Deck opened.',
    none: 'No subagents in this session yet.',
    running: 'Running',
    ended: 'Finished',
    clear: 'clear',
    starting: 'starting …',
    aborted: 'aborted',
    steps: 'steps',
    step: 'step',
    tokens: 'T.',
    working: 'working',
    earlier: 'earlier steps',
    stop: 'Stop',
    session: 'Session',
    started: 'Started',
    context: 'Context',
    of: 'of',
    used: 'Tokens used',
    limits: 'Usage limits',
    five_hour: 'Session (5h)',
    seven_day: 'Week (7 days)',
    spend_limit: 'Spend limit',
    reset: 'Resets',
    warm: 'Keep cache warm',
    on: 'On',
    off: 'Off',
    turnOn: 'Turn on',
    turnOff: 'Turn off',
    nextPing: 'next ping in',
    lastPing: 'last ping',
    fromCache: 'read from cache',
    cold: 'cache was cold, written afresh:',
    noReply: 'no reply',
  },
} as const

type Words = (typeof TEXT)[Lang]

// Module variables start over on every reload; session.start starts the clock again.
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

/** 950 → "950", 41 984 → "42k", 1 234 567 → "1,23 M" (German) or "1.23 M" (English) */
function tokens(n: number, l: Lang): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  const m = (n / 1_000_000).toFixed(2)
  return `${l === 'de' ? m.replace('.', ',') : m} M`
}

/** A request's input including the cache: the size of the context the model read. */
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

function clockText(at: number, withDate: boolean, w: Words): string {
  try {
    const date: Intl.DateTimeFormatOptions = withDate ? { weekday: 'short', day: 'numeric', month: 'numeric' } : {}
    return new Intl.DateTimeFormat(w.locale, { timeZone: 'Europe/Vienna', ...date, hour: '2-digit', minute: '2-digit' }).format(at)
  } catch {
    return ''
  }
}

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

/** What the agent is working on: the target of its tool call in a few words. */
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

/** "in 2h 14min · 18:10", with weekday and date when asked; Vienna time where the runtime knows time zones. */
function resetText(iso: string | undefined, t: number, withDate: boolean, w: Words): string {
  if (!iso) return ''
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const min = Math.max(0, Math.round((at - t) / 60_000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const rel = d ? `in ${d}d ${h}h` : h ? `in ${h}h ${m}min` : `in ${m}min`
  const abs = clockText(at, withDate, w)
  return abs ? `${rel} · ${abs}` : rel
}

function barSvg(pct: number, px: number, color: string): string {
  const w = Math.max(0, Math.min(100, pct))
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

const SPIN = ['◐', '◓', '◑', '◒']
const SPINNER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">' +
  '<circle cx="6" cy="6" r="4.5" fill="none" stroke="#e08a1e" stroke-opacity="0.3" stroke-width="2"/>' +
  '<path d="M6 1.5 A4.5 4.5 0 0 1 10.5 6" fill="none" stroke="#e08a1e" stroke-width="2" stroke-linecap="round">' +
  '<animateTransform attributeName="transform" type="rotate" from="0 6 6" to="360 6 6" dur="1s" repeatCount="indefinite"/>' +
  '</path></svg>'

function barText(pct: number, cols: number): string {
  const n = Math.round((Math.max(0, Math.min(100, pct)) / 100) * cols)
  return '█'.repeat(n) + '░'.repeat(cols - n)
}

async function anyRunning($: EngineInterface): Promise<boolean> {
  return (await read($, agents)).some(a => a.phase === 'running')
}

/**
 * While an agent works: redraw every second, check its status every 3 s.
 * Otherwise every 30 s, so the countdown to the limits' reset keeps moving.
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

/** Sends the ping when "keep warm" is on and the main chat has been quiet for 50 min. */
async function checkWarm($: EngineInterface, t: number) {
  const w = await read($, warm)
  if (!w.on || pinging || t - w.lastRequestAt < WARM_AFTER_MS) return
  pinging = true
  try {
    // A fork: the chat as last sent plus one line, without tools and invisible in the chat.
    // It reads the cache and so restarts its 60 minutes.
    const r = await $.model.fork({ prompt: PING_PROMPT })
    // It worked when the chat came from the cache: more read from it than written to it.
    const read_ = r.usage?.cache_read_input_tokens ?? 0
    const write = r.usage?.cache_creation_input_tokens ?? 0
    const ok = r.isAnswered && read_ > 0 && read_ >= write
    const at = await $.clock.now()
    await update($, warm, v => {
      const pings = v.pings + 1
      // Failed: try again in 2 min, while the cache is still alive.
      const lastRequestAt = ok ? at : v.lastRequestAt + 2 * 60_000
      return { ...v, on: v.on && pings < MAX_PINGS, lastRequestAt, pings, lastPingAt: at, lastPingOk: ok, lastPingRead: read_, lastPingWrite: write }
    })
  } finally {
    pinging = false
  }
}

/** Compares with the engine's agent list: catches aborts and missed ends. */
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

export const register: Register = (on, options) => {
  // The language comes from the plugin setting `language`, asked at install; changing it reloads the module.
  const l: Lang = options.language === 'de' ? 'de' : 'en'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agentdeck', description: TEXT[l].command })
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
      // No subscription, or before the first response: no limits, the section stays away.
    }
    return r
  })

  // After every response, and when a limit moves a whole percentage point.
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

  on('command.run', { command: 'agentdeck' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: TEXT[l].opened }
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
        list.map(a =>
          a.id === id
            ? { ...a, tool, detail, steps: a.steps + 1, history: [...(a.history ?? []), { tool, detail }].slice(-HISTORY) }
            : a,
        ),
      )
    }
    return next(e)
  })

  // Every model request: context and output per subagent, totals for the whole session.
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
      // A real request of the main chat just renewed the cache: ping clock and counter start over.
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
    // Switching on counts the quiet from now when no request has been seen yet.
    await update($, warm, v => ({ ...v, on: !v.on, pings: 0, lastRequestAt: v.lastRequestAt || t }))
    return { element: 'warm' }
  })

  on('ui.press', { plugin: NAME, element: 'clear' }, async ($, e, next) => {
    await update($, agents, list => list.filter(a => a.phase === 'running'))
    return { element: 'clear' }
  })

  // The presses are answered here, not passed on to the Button's (empty) onPress: the
  // redraw a press causes can drop that Button's handle before the chain reaches it.
  // Per agent: "steps-<id>" folds its step list open or shut, "stop-<id>" stops it.
  on('ui.press', { plugin: NAME }, async ($, e, next) => {
    const el = e.element ?? ''
    if (el.startsWith('steps-')) {
      const id = el.slice('steps-'.length)
      await update($, open, ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]))
      return { element: el }
    } else if (el.startsWith('stop-')) {
      const id = el.slice('stop-'.length)
      // A background subagent is a task under its agent id; TaskStop ends it as /tasks would.
      await $.tool.call({ tool: 'TaskStop', task_id: id } as never).catch(() => undefined)
      await finish($, id, 'failed')
      return { element: el }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const w = TEXT[l]
    const list = await read($, agents)
    // Before the first tick the clock reads 0: take the real time then.
    const t = (await read($, now)) || (await $.clock.now())
    const openIds = await read($, open)
    const running = list.filter(a => a.phase === 'running')
    const ended = list.filter(a => a.phase !== 'running').reverse()

    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null

    // Running: an orange circle that turns (SVG animation; in the terminal one glyph per second).
    const mark = (a: Agent) => {
      if (a.phase === 'running') {
        return Svg ? (
          <Svg source={SPINNER_SVG} alt={w.working} width={12} height={12} />
        ) : (
          <Text color="warning" bold>{SPIN[Math.floor(t / 1000) % SPIN.length]}</Text>
        )
      }
      return a.phase === 'done' ? (
        <Text color="success" bold>✔</Text>
      ) : (
        <Text color="error" bold>✘</Text>
      )
    }

    // Two lines per agent: task and run time, below it type, model, activity and tokens.
    const row = (a: Agent) => {
      const live = a.phase === 'running'
      const time = duration((live ? Math.max(t, a.startedAt) : (a.endedAt ?? a.startedAt)) - a.startedAt)
      // Order: steps, tokens, model, type; then what a running agent does now
      // (or "aborted"), last so it is the part cut off when the row is narrow.
      const doing = live
        ? a.tool
          ? `${a.tool}: ${a.detail || '…'}`
          : w.starting
        : a.phase === 'done'
          ? ''
          : w.aborted
      const used = a.context !== undefined ? `${tokens(a.context + (a.output ?? 0), l)} ${w.tokens}` : ''
      const second = [`${a.steps} ${a.steps === 1 ? w.step : w.steps}`, used, a.model, a.type, doing].filter(Boolean).join(' · ')
      const history = a.history ?? []
      const isOpen = openIds.includes(a.id)
      const older = a.steps - history.length
      return (
        <Box key={a.id} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
            {mark(a)}
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text bold={live} wrap="truncate-end">
                {a.description}
              </Text>
            </Box>
            <Text dimColor={!live}>{time}</Text>
          </Box>
          {/* Info line: the arrow folds the steps open; the text is cut with … rather than
              wrapped (a fixed height or hidden overflow makes VS Code stack the row). */}
          <Box paddingLeft={2} flexDirection="row" flexWrap="nowrap" columnGap={1} alignItems="center">
            {history.length ? (
              <Button key={`steps-${a.id}`} plain label={isOpen ? '▾' : '▸'} onPress={() => undefined} />
            ) : null}
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text dimColor wrap="truncate-end">{second}</Text>
            </Box>
          </Box>
          {/* Stop sits on its own line right below, for a running agent only. */}
          {live ? (
            <Box paddingLeft={2} flexDirection="row" flexWrap="nowrap">
              <Button key={`stop-${a.id}`} plain onPress={() => undefined}>
                {w.stop}
              </Button>
            </Box>
          ) : null}
          {isOpen ? (
            <Box paddingLeft={4} flexDirection="column">
              {older > 0 ? <Text dimColor>{`… ${older} ${w.earlier}`}</Text> : null}
              {history.map((s, i) => (
                <Text key={`s-${a.id}-${i}`} dimColor wrap="truncate-end">
                  {`${older + i + 1}. ${s.tool}${s.detail ? `: ${s.detail}` : ''}`}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
      )
    }

    const windows = await read($, limits)
    const cols = e.props.bodyColumns

    const bar = (pct: number, label: string, color: string) =>
      Svg ? (
        <Svg source={barSvg(pct, Math.max(80, Math.floor(cols * 6.5)), color)} alt={`${label}: ${Math.round(pct)} %`} height={6} />
      ) : (
        <Text color={color}>{barText(pct, Math.max(10, cols - 2))}</Text>
      )

    const limit = (lim: RateLimit, i: number) => {
      const pct = lim.percentUsed
      const label = (w as Record<string, string>)[lim.kind] ?? lim.kind
      // The 5h window always ends today or early tomorrow: the time is enough.
      const reset = resetText(lim.resetsAt, t, lim.kind !== 'five_hour', w)
      return (
        <Box key={`limit-${lim.kind}`} flexDirection="column" marginTop={i ? 1 : 0}>
          <Box flexDirection="row" flexWrap="nowrap" gap={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text>{label}</Text>
            </Box>
            <Text bold>{`${Math.round(pct)} %`}</Text>
          </Box>
          {bar(pct, label, limitColor(pct))}
          {reset ? <Text dimColor wrap="truncate-end">{`${w.reset} ${reset}`}</Text> : null}
        </Box>
      )
    }

    const pair = (key: string, label: string, value: string) => (
      <Box key={key} flexDirection="row" flexWrap="nowrap" gap={1}>
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
        <Text bold>{w.session}</Text>
        {s.startedAt !== undefined ? pair('started', w.started, clockText(s.startedAt, true, w)) : null}
        {s.contextTokens !== undefined
          ? pair(
              'ctx',
              w.context,
              `${tokens(s.contextTokens, l)}${s.contextWindow ? ` ${w.of} ${tokens(s.contextWindow, l)}` : ''}${ctxPct !== undefined ? ` (${Math.round(ctxPct)} %)` : ''}`,
            )
          : null}
        {ctxPct !== undefined ? bar(ctxPct, w.context, contextColor(ctxPct)) : null}
        {pair('used', w.used, tokens(s.input + s.output, l))}
      </Box>
    ) : null

    const wm = await read($, warm)
    // The last ping on a line of its own, with what it proves: the chat read from the cache.
    const pingWhat =
      wm.lastPingRead === undefined
        ? ''
        : wm.lastPingOk
          ? `${tokens(wm.lastPingRead, l)} ${w.fromCache}`
          : wm.lastPingRead || wm.lastPingWrite
            ? `${w.cold} ${tokens(wm.lastPingWrite ?? 0, l)}`
            : w.noReply
    const last =
      wm.lastPingAt !== undefined
        ? `${w.lastPing} ${clockText(wm.lastPingAt, false, w)}${pingWhat ? ` · ${pingWhat}` : ''} ${wm.lastPingOk ? '✓' : '✗'}`
        : ''
    const nextIn = Math.max(0, Math.ceil((wm.lastRequestAt + WARM_AFTER_MS - t) / 60_000))
    const warmText = wm.on
      ? [`${w.nextPing} ${nextIn}min`, `${wm.pings}/${MAX_PINGS}`].join(' · ')
      : ''

    // Light rule between the blocks at the bottom (dim; the top one is strong).
    const lightRule = <Text dimColor wrap="truncate-end">{'─'.repeat(Math.max(10, cols))}</Text>

    // At least as tall as the pane, so the list grows and session and limits sit at the bottom.
    // VS Code and the desktop give the tree no full-height parent and round the pane's height
    // down to whole rows of a slightly taller line than the tree's: half a row more fills it
    // (a whole row overshot, and the pane scrolled by a few pixels).
    const minHeight = e.props.scroll.bodyRows + (e.surface === 'terminal' ? 0 : 0.5)

    return (
      <Box flexDirection="column" minHeight={minHeight}>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {list.length === 0 ? <Text dimColor>{w.none}</Text> : null}
          {running.length ? <Text bold>{`${w.running} (${running.length})`}</Text> : null}
          {running.map(row)}
          {ended.length ? (
            <Box flexDirection="row" flexWrap="nowrap" gap={1}>
              <Text bold>{`${w.ended} (${ended.length})`}</Text>
              <Button key="clear" plain onPress={() => undefined}>
                <Text dimColor>{w.clear}</Text>
              </Button>
            </Box>
          ) : null}
          {ended.map(row)}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text wrap="truncate-end">{'─'.repeat(Math.max(10, cols))}</Text>
          {info}
          {windows.length ? (
            <Box flexDirection="column">
              {info ? lightRule : null}
              <Text bold>{w.limits}</Text>
              {windows.map(limit)}
            </Box>
          ) : null}
          <Box flexDirection="column">
            {lightRule}
            {/* columnGap, not gap: gap also spaces downward, which VS Code drew as an empty line. */}
            <Box flexDirection="row" flexWrap="nowrap" columnGap={1} alignItems="center">
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text>{w.warm}</Text>
              </Box>
              {/* VS Code and the desktop draw every Button as their own native button, which takes no
                  colour: the state stands in colour beside it, the button says what it does. */}
              <Text color={wm.on ? GREEN : RED} bold>
                {`● ${wm.on ? w.on : w.off}`}
              </Text>
              <Button key="warm" onPress={() => undefined}>
                {wm.on ? w.turnOff : w.turnOn}
              </Button>
            </Box>
            {warmText ? <Text dimColor wrap="truncate-end">{warmText}</Text> : null}
            {last ? <Text dimColor wrap="truncate-end">{last}</Text> : null}
          </Box>
        </Box>
      </Box>
    )
  })
}
