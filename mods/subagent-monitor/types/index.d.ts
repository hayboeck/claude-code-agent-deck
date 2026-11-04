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

/** Ein Limit-Fenster, wie die Engine es meldet (five_hour, seven_day, spend_limit). */
export type RateLimit = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-monitor': {
      agents: Shaped<Agent[]>
      now: number
      limits: Shaped<RateLimit[]>
    }
  }
}
