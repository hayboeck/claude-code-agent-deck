import { expect, mock, test } from 'claude-code/testing'

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

test('ein Subagent erscheint mit Typ und aktuellem Werkzeug', async ($, on) => {
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
    expect((await ui.find({ type: 'Text', text: /Explore/ }))?.text).toBe('Explore · sonnet')
    expect((await ui.find({ type: 'Text', text: /^Read/ }))?.text).toBe('Read: register.tsx')
    await ui.unmount()
  }

  await clock.advance(65_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /^1:0/ }))?.text).toBe('1:05')
  await ui.unmount()
})

test('Limits erscheinen unten mit Prozent und Rücksetzzeit', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-11-04T15:00:00Z') })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200000 } as never,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 8, resetsAt: '2026-11-04T17:10:00Z' },
      { kind: 'seven_day', percentUsed: 32, resetsAt: '2026-11-08T12:00:00Z' },
    ],
    changed: ['rateLimits'],
  })

  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Session/ }))?.text).toBe('Session (5 h)')
    expect((await ui.find({ type: 'Text', text: /^32/ }))?.text).toBe('32 %')
    expect((await ui.find({ type: 'Text', text: /zurückgesetzt in 2 h 10 min/ }))).toBeDefined()
    await ui.unmount()
  }
})

test('leere Sitzung zeigt einen Hinweis', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Noch keine Subagents in dieser Sitzung.')
  await ui.unmount()
})
