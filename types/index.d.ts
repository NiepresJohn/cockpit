// Must stay self-contained (the validator rejects imports); keep in step with State in hooks/lib.ts.
export type Limit = { kind: string; pct: number; resetsAt: string | null }
export type Agent = {
  id: string
  name: string
  tool: string
  doing: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  since: number
  endAt: number | null
  steps: number
  ctx: number
}
export type CockpitState = {
  model: string
  effort: string
  running: boolean
  turnStart: number
  edits: number
  activity: string
  ctxPct: number | null
  ctxTokens: number | null
  ctxWindow: number
  cost: number | null
  limits: Limit[]
  where: { repo: string; branch: string; add: number; del: number; ahead: number; behind: number }
  agents: Agent[]
  lastTurn: { ms: number; edits: number } | null
  hist: number[]
  tools: number
  turns: number
  startedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: { state: CockpitState }
  }
}
