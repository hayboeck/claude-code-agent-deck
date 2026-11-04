import { expect, mock, test } from 'claude-code/testing'

// The German texts are checked with the setting language: de; English is the default.
const DE = { options: { language: 'de' } }

const PANE = {
  plugin: 'subagent-monitor',
  component: 'Pane',
  requestId: 'subagents',
  props: {
    title: 'Subagents',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('a subagent shows with its type and current tool', DE, async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  on('command.register', () => ({ value: { command: 'subagents' } }))
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
    expect((await ui.find({ type: 'Text', text: /Explore/ }))?.text).toBe('Explore · sonnet · Read: register.tsx')
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
  on('command.register', () => ({ value: { command: 'subagents' } }))
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
  expect((await ui.find({ type: 'Text', text: /aborted/ }))?.text).toMatch(/aborted · 2 steps/)
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

test('keep warm pings once through a fork after 50 min of quiet', DE, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-04T15:00:00Z') })
  const forks: string[] = []
  on('command.register', () => ({ value: { command: 'subagents' } }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: Date.parse('2026-11-04T14:00:00Z'), context: { window: 200000, tokens: 50000 }, rateLimits: [] },
  }))
  on('model.fork', (_, e) => {
    forks.push(e.prompt)
    return { value: { isAnswered: true, text: 'OK', usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 50000, cache_creation_input_tokens: 0 } } }
  })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'warm' })
  expect((await ui.find({ type: 'Text', text: /nächster Ping/ }))?.text).toMatch(/^nächster Ping in 50min · 0\/5/)

  await clock.advance(49 * 60_000)
  expect(forks.length).toBe(0)
  await clock.advance(2 * 60_000)
  expect(forks.length).toBe(1)
  expect((await ui.find({ type: 'Text', text: /letzter Ping/ }))?.text).toMatch(/1\/5 · letzter Ping .* ✓$/)
  await ui.unmount()
})

test('an empty session shows a hint', DE, async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /^Noch keine/ }))?.text).toBe('Noch keine Subagents in dieser Sitzung.')
  await ui.unmount()
})
