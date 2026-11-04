export type Phase = 'running' | 'done' | 'failed'

export type Agent = {
  id: string
  description: string
  type: string
  model: string
  startedAt: number
  endedAt?: number
  phase: Phase
  /** Zuletzt aufgerufenes Werkzeug und sein Ziel (Datei, Befehl, Suchmuster). */
  tool?: string
  detail?: string
  steps: number
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-monitor': {
      agents: Shaped<Agent[]>
      now: number
    }
  }
}
