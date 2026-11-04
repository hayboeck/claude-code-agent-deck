import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Phase } from '../types'

const NAME = 'subagent-monitor'
const PANE = 'subagents'
const TITLE = 'Subagents'
const KEEP = 30 // so viele Agenten bleiben in der Liste
const TICK_MS = 1000
const POLL_MS = 3000

// Tag ändern, wenn sich die Felder von Agent ändern: alte gespeicherte Werte werden dann verworfen.
const agents = atom({ plugin: 'subagent-monitor', key: 'agents' } as const, [], { shape: 'agents-1' })
const now = atom({ plugin: 'subagent-monitor', key: 'now' } as const, 0)

// Modulvariablen beginnen bei jedem Neuladen von vorn; session.start startet die Uhr wieder.
let ticker: { cancel(): void } | null = null
let ticks = 0

const MS = 1000
function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / MS))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
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

async function anyRunning($: EngineInterface): Promise<boolean> {
  return (await read($, agents)).some(a => a.phase === 'running')
}

/** Uhr läuft nur, solange ein Agent arbeitet: jede Sekunde neu zeichnen, alle 3 s Status abgleichen. */
async function syncClock($: EngineInterface) {
  if (await anyRunning($)) {
    ticker ??= $.clock.every(TICK_MS, () => {
      void tick($).catch(() => undefined)
    })
  } else {
    ticker?.cancel()
    ticker = null
    { const t = await $.clock.now(); await update($, now, () => t) }
  }
}

async function tick($: EngineInterface) {
  { const t = await $.clock.now(); await update($, now, () => t) }
  ticks++
  if (ticks % (POLL_MS / TICK_MS) === 0) await poll($)
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

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) {
      const failed = e.reason === 'error' || e.reason === 'refusal' || e.isAborted
      await finish($, e.agentId, failed ? 'failed' : 'done')
    }
    return r
  })

  on('ui.press', { plugin: NAME, element: 'clear' }, async ($, e, next) => {
    await update($, agents, list => list.filter(a => a.phase === 'running'))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, agents)
    const t = await read($, now)
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
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {list.length === 0 ? <Text dimColor>Noch keine Subagents in dieser Sitzung.</Text> : null}
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
    )
  })
}
