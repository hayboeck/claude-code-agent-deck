export type Phase = 'running' | 'done' | 'failed'

/** Display language of the pane: the plugin setting `language`. */
export type Lang = 'de' | 'en'

export type Step = { tool: string; detail: string }

export type Agent = {
  id: string
  description: string
  type: string
  model: string
  startedAt: number
  endedAt?: number
  phase: Phase
  /** Last tool called and its target (file, command, search pattern). */
  tool?: string
  detail?: string
  steps: number
  /** The latest steps, oldest first (at most 30): tool and target, as `tool` and `detail` above. */
  history?: Step[]
  /** Context size of the last request (input incl. cache) and generated tokens, summed. */
  context?: number
  output?: number
}

/** Context and usage of the main session. */
export type SessionInfo = {
  startedAt?: number
  contextTokens?: number
  contextWindow?: number
  contextPercent?: number
  /** Totals over all requests since `countingSince` (main chat and subagents). */
  input: number
  cacheRead: number
  output: number
  countingSince: number
  usd?: number
}

/** One limit window as the engine reports it (five_hour, seven_day, spend_limit). */
export type RateLimit = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

/** Keeping the prompt cache warm: an invisible ping over the chat before the cache expires. */
export type Warm = {
  on: boolean
  /** Last request that read the main chat's cache (its own reply or a ping). */
  lastRequestAt: number
  pings: number
  lastPingAt?: number
  lastPingOk?: boolean
  /** Tokens the last ping read from the cache, and wrote to it afresh. */
  lastPingRead?: number
  lastPingWrite?: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-deck': {
      agents: Shaped<Agent[]>
      now: number
      limits: Shaped<RateLimit[]>
      session: Shaped<SessionInfo | null>
      warm: Shaped<Warm>
      /** Ids of the agents whose steps are unfolded. */
      open: Shaped<string[]>
    }
  }
}
