import { expect, mock, test } from 'claude-code/testing'

// The German texts are checked with the setting language: de; English is the default.
const DE = { options: { language: 'de' } }

const PANE = {
  plugin: 'agent-deck',
  component: 'Pane',
  requestId: 'agentdeck',
  props: {
    title: 'Agent Deck',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('a subagent shows with its type and current tool', DE, async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  on('command.register', () => ({ value: { command: 'agentdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.agent.spawn({ prompt: 'x', description: 'Dateien durchsuchen', subagentType: 'Explore' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/a/b/register.tsx', agentId: 'a1' })

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Dateien durchsuchen/ }))?.text).toBe('Dateien durchsuchen')
    expect((await ui.find({ type: 'Text', text: /Explore/ }))?.text).toBe('1 Schritt · sonnet · Explore · Read: register.tsx')
    await ui.unmount()
  }

  await clock.advance(65_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /^1:0/ }))?.text).toBe('1:05')
  await ui.unmount()
})

test('steps fold open and Stop ends a running subagent', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const stopped: string[] = []
  on('command.register', () => ({ value: { command: 'agentdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', (_, e) => {
    if (e.tool === 'TaskStop') stopped.push(String((e as unknown as { task_id: string }).task_id))
    return { result: {} }
  })

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.agent.spawn({ prompt: 'x', description: 'Look around', subagentType: 'Explore' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/a/README.md', agentId: 'a1' })
  await $.tool.call({ tool: 'Grep', pattern: 'TODO', path: 'C:/a/src', agentId: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^1\. Read/ })).toBeUndefined()
  await ui.press({ key: 'steps-a1' })
  expect((await ui.find({ type: 'Text', text: /^1\. / }))?.text).toBe('1. Read: README.md')
  expect((await ui.find({ type: 'Text', text: /^2\. / }))?.text).toBe('2. Grep: TODO in src')
  await ui.press({ key: 'steps-a1' })
  expect(await ui.find({ type: 'Text', text: /^1\. Read/ })).toBeUndefined()

  await ui.press({ key: 'stop-a1' })
  expect(stopped).toEqual(['a1'])
  expect((await ui.find({ type: 'Text', text: /aborted/ }))?.text).toMatch(/^2 steps · haiku · Explore · aborted$/)
  await ui.unmount()
})

const MEASURE = {
  context: { window: 200000, tokens: 85000, percent: 43 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 8, resetsAt: '2026-11-04T17:10:00Z' },
    { kind: 'seven_day', percentUsed: 32, resetsAt: '2026-11-08T12:00:00Z' },
  ],
  changed: ['rateLimits'],
} as const

test('limits show at the bottom with percentage and reset time', DE, async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-11-04T15:00:00Z') })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure({ ...MEASURE, rateLimits: [...MEASURE.rateLimits], changed: [...MEASURE.changed] })

  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Session/ }))?.text).toBe('Session (5h)')
    expect((await ui.find({ type: 'Text', text: /^32/ }))?.text).toBe('32 %')
    expect((await ui.find({ type: 'Text', text: /^85k/ }))?.text).toBe('85k von 200k (43 %)')
    expect((await ui.find({ type: 'Text', text: /Reset in 2h 10min/ }))?.text).toMatch(/^Reset in 2h 10min( · 18:10)?$/)
    expect((await ui.find({ type: 'Text', text: /Reset in 3d/ }))?.text).toMatch(/^Reset in 3d 21h/)
    await ui.unmount()
  }
})

test('without a setting every text is English', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-11-04T15:00:00Z') })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure({ ...MEASURE, rateLimits: [...MEASURE.rateLimits], changed: [...MEASURE.changed] })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /^Usage limits$/ }))?.text).toBe('Usage limits')
  expect((await ui.find({ type: 'Text', text: /^Week/ }))?.text).toBe('Week (7 days)')
  expect((await ui.find({ type: 'Text', text: /^85k/ }))?.text).toBe('85k of 200k (43 %)')
  expect((await ui.find({ type: 'Text', text: /^Resets in 2h 10min/ }))?.text).toMatch(/^Resets in 2h 10min( · 18:10)?$/)
  expect((await ui.find({ type: 'Text', text: /^Keep cache warm$/ }))?.text).toBe('Keep cache warm')
  expect((await ui.find({ type: 'Text', text: /^● / }))?.text).toBe('● Off')
  await ui.press({ key: 'warm' })
  expect((await ui.find({ type: 'Text', text: /^● / }))?.text).toBe('● On')
  expect(await ui.find({ type: 'Text', text: /Nutzungslimits/ })).toBeUndefined()
  await ui.unmount()
})

// Plays the ping's turn as the engine would: the prompt enters, a turn starts, one request.
function engine(on: Parameters<Parameters<typeof test>[2]>[1], cache: { read: number; write: number }) {
  const sent: string[] = []
  on('command.register', () => ({ value: { command: 'agentdeck' } }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: Date.parse('2026-11-04T14:00:00Z'), context: { window: 200000, tokens: 50000 }, rateLimits: [] },
  }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text, origin: e.origin }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId, index: e.index, answer: 'OK', toolUses: [], stopReason: 'end_turn' as const,
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: cache.read, cache_creation_input_tokens: cache.write },
    }
  })
  on('turn.complete', (_, e) => ({ text: '' }))
  on('tool.call', () => ({ result: {} }))
  return sent
}

async function pingTurn($: Parameters<Parameters<typeof test>[2]>[0]) {
  await $.turn.start({ text: 'ping', turnId: 't-ping' })
  const step = $.turn.step({ turnId: 't-ping', index: 0, model: 'opus', messageCount: 3 })
  for await (const _ of step) void _
  await step.result
}

test('keep warm sends a ping message in the set language after 50 min of quiet', DE, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-04T15:00:00Z') })
  const sent = engine(on, { read: 50000, write: 300 })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'warm' })
  expect((await ui.find({ type: 'Text', text: /nächster Ping/ }))?.text).toMatch(/^nächster Ping in 50min · 0\/5/)

  await clock.advance(49 * 60_000)
  expect(sent.length).toBe(0)
  await clock.advance(2 * 60_000)
  expect(sent).toEqual(['Cache-Ping von Agent Deck: antworte nur mit OK, keine Werkzeuge.'])
  expect((await ui.find({ type: 'Text', text: /letzter Ping/ }))?.text).toMatch(/^letzter Ping \S+ …$/)

  await pingTurn($)
  // Tools are refused while the ping's turn runs.
  const denied = await $.tool.call({ tool: 'Read', file_path: 'C:/a.txt' })
  expect(JSON.stringify(denied)).toContain('no tools')
  await $.turn.complete({ turnId: 't-ping', answer: 'OK', durationMs: 900, isAborted: false, reason: 'answer' } as never)

  expect((await ui.find({ type: 'Text', text: /nächster Ping/ }))?.text).toMatch(/^nächster Ping in \d+min · 1\/5$/)
  expect((await ui.find({ type: 'Text', text: /letzter Ping/ }))?.text).toMatch(/^letzter Ping \S+ · 50k aus dem Cache ✓$/)
  await ui.unmount()
})

test('a ping that finds the cache cold says so, in English by default', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-04T15:00:00Z') })
  const sent = engine(on, { read: 3000, write: 47000 })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'warm' })
  await clock.advance(51 * 60_000)
  expect(sent).toEqual(['Cache ping from Agent Deck: reply only with OK, use no tools.'])
  await pingTurn($)
  expect((await ui.find({ type: 'Text', text: /last ping/ }))?.text).toMatch(/^last ping \S+ · cache was cold, written afresh: 47k ✗$/)
  await ui.unmount()
})

test('an empty session shows a hint', DE, async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /^Noch keine/ }))?.text).toBe('Noch keine Subagents in dieser Sitzung.')
  await ui.unmount()
})

test('a long info line is cut off, not wrapped', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('command.register', () => ({ value: { command: 'agentdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.agent.spawn({ prompt: 'x', description: 'Search', subagentType: 'general-purpose' })
  await $.tool.call({ tool: 'Grep', pattern: 'a-very-long-search-pattern-that-never-fits', path: 'C:/a/some/deep/folder', agentId: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode', props: { ...PANE.props, bodyColumns: 40 } })
  const info = await ui.find({ type: 'Text', text: /^1 step / })
  expect(info?.text).toMatch(/^1 step · sonnet · general-purpose · Grep/)
  expect(await ui.find({ type: 'Text', wrap: 'truncate-end', text: /^1 step / } as never)).toBeDefined()
  await ui.unmount()
})

test('a multi-line command stays on one line', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('command.register', () => ({ value: { command: 'agentdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.agent.spawn({ prompt: 'x', description: 'Grade\nanswers', subagentType: 'general-purpose' })
  await $.tool.call({ tool: 'Bash', command: 'python - <<EOF\nimport re\n\tprint(1)\nEOF', agentId: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /^Grade/ }))?.text).toBe('Grade answers')
  expect((await ui.find({ type: 'Text', text: /^1 step / }))?.text).toBe('1 step · opus · general-purpose · Bash: python - <<EOF import re print(1) EOF')
  await ui.press({ key: 'steps-a1' })
  expect((await ui.find({ type: 'Text', text: /^1\. / }))?.text).toBe('1. Bash: python - <<EOF import re print(1) EOF')
  await ui.unmount()
})
