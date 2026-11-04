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
  /** Kontextgröße der letzten Anfrage (Eingabe inkl. Cache) und erzeugte Tokens, summiert. */
  context?: number
  output?: number
}

/** Kontext und Verbrauch der Hauptsitzung. */
export type SessionInfo = {
  startedAt?: number
  contextTokens?: number
  contextWindow?: number
  contextPercent?: number
  /** Summen über alle Anfragen seit `countingSince` (Hauptchat und Subagents). */
  input: number
  cacheRead: number
  output: number
  countingSince: number
  usd?: number
}

/** Ein Limit-Fenster, wie die Engine es meldet (five_hour, seven_day, spend_limit). */
export type RateLimit = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

/** Warmhalten des Prompt-Caches: ein unsichtbarer Ping über den Chatverlauf, bevor der Cache abläuft. */
export type Warm = {
  on: boolean
  /** Letzte Anfrage, die den Cache des Hauptchats gelesen hat (eigene Antwort oder Ping). */
  lastRequestAt: number
  pings: number
  lastPingAt?: number
  lastPingOk?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-monitor': {
      agents: Shaped<Agent[]>
      now: number
      limits: Shaped<RateLimit[]>
      session: Shaped<SessionInfo | null>
      warm: Shaped<Warm>
    }
  }
}
