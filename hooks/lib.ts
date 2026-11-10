// Pure helpers for Cockpit: formatting, parsing and the card's row maths. No host API in here.

export type Limit = { kind: string; pct: number; resetsAt: string | null }
export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'
export type Agent = {
  id: string
  name: string
  tool: string
  doing: string
  status: AgentStatus
  since: number
  endAt: number | null
  steps: number
  ctx: number
}
export type Where = { repo: string; branch: string; add: number; del: number; ahead: number; behind: number }
export type LastTurn = { ms: number; edits: number }
export type State = {
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
  where: Where
  agents: Agent[]
  lastTurn: LastTurn | null
  /** Context % at the end of each of the last HIST_LEN turns, oldest first. */
  hist: number[]
  tools: number
  turns: number
  startedAt: number
}

export const EMPTY: State = {
  model: '',
  effort: '',
  running: false,
  turnStart: 0,
  edits: 0,
  activity: '',
  ctxPct: null,
  ctxTokens: null,
  ctxWindow: 0,
  cost: null,
  limits: [],
  where: { repo: '', branch: '', add: 0, del: 0, ahead: 0, behind: 0 },
  agents: [],
  lastTurn: null,
  hist: [],
  tools: 0,
  turns: 0,
  startedAt: 0,
}

/** Tokyo-night palette, the one Cockpit ships with. */
export const COLORS = {
  accent: '#7aa2f7',
  cyan: '#7dcfff',
  green: '#9ece6a',
  purple: '#bb9af7',
  amber: '#e0af68',
  red: '#f7768e',
  dim: '#565f89',
  faint: '#3b4261',
  text: '#c0caf5',
}
export type Colors = typeof COLORS

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
export const MAX_AGENTS = 24
/** A subagent still "running" after this long never reported back (crash, abort); stop showing it. */
export const STALE_AGENT_MS = 6 * 3_600_000
export const AGENT_ROWS = 6
export const HIST_LEN = 12
export const NARROW = 64
/** Rows of the card without the agents section: header, activity, rule, two meter rows, stats. */
export const BASE_ROWS = 6

/** Safe-ish text from stored state: anything not the shape we wrote falls back to the default. */
export const restore = (stored: unknown): State => {
  const s = typeof stored === 'object' && stored !== null ? (stored as Partial<State>) : {}
  return {
    ...EMPTY,
    ...s,
    where: { ...EMPTY.where, ...(s.where ?? {}) },
    agents: Array.isArray(s.agents) ? s.agents : [],
    limits: Array.isArray(s.limits) ? s.limits : [],
    hist: Array.isArray(s.hist) ? s.hist.filter(n => typeof n === 'number') : [],
  }
}

/** Control bytes (ESC, BEL, C1) would reach the terminal as escape sequences. */
const stripControl = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')

export const clip = (s: string, n: number) => {
  const one = stripControl(s).replace(/\s+/g, ' ').trim()
  if (n <= 0) return ''
  return one.length > n ? `${one.slice(0, Math.max(0, n - 1)).trimEnd()}…` : one
}

/** `claude-opus-5-5[1m]` → `Opus 5.5 1M`; provider-prefixed and dated ids too; unknown ids are clipped. */
export const modelName = (id: string) => {
  if (!id) return '—'
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  const big = /\[1m\]|-1m\b/i.test(id) ? ' 1M' : ''
  const next = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?!\d)/i.exec(id)
  if (next?.[1]) return `${cap(next[1])} ${next[2]}${next[3] ? `.${next[3]}` : ''}${big}`
  const prev = /claude-(\d+)(?:-(\d))?-([a-z]+)/i.exec(id)
  if (prev?.[3]) return `${cap(prev[3])} ${prev[1]}${prev[2] ? `.${prev[2]}` : ''}${big}`
  return clip(id, 22)
}

export const usd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)

export const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)

/** m:ss, or XhYY once past an hour. */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** Time until an ISO instant: `2h14m`, `3d4h`, `<1m`; empty when unknown or already past. */
export const countdown = (iso: string | null | undefined, now: number) => {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t) || t <= now) return ''
  const m = Math.floor((t - now) / 60000)
  if (m < 1) return '<1m'
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d${h}h` : h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

/** The limit named like the 5-hour or 7-day window, if the host reports one. */
export const findWindow = (limits: Limit[], which: 'five' | 'seven') => {
  const re = which === 'five' ? /five|5/i : /seven|7/i
  const exact = which === 'five' ? 'five_hour' : 'seven_day'
  return limits.find(l => l.kind === exact) ?? limits.find(l => re.test(l.kind))
}

/** The highest mark a reading climbed through, else null. First reading never counts. */
export const crossed = (prev: number | undefined, next: number, marks: readonly number[] = [85, 95]) =>
  prev === undefined ? null : ([...marks].reverse().find(m => prev < m && next >= m) ?? null)

/** Short name for a limit kind: `five_hour` → `5h`, `seven_day_opus` → `7d opus`. */
export const windowLabel = (kind: string) =>
  kind
    .replace(/five[_ -]?hours?/i, '5h')
    .replace(/seven[_ -]?days?/i, '7d')
    .replace(/[_-]+/g, ' ')
    .trim()

/** Sum of `git diff --numstat`: binary files report `-` and count as zero. */
export const diffTotals = (numstat: string) => {
  let add = 0
  let del = 0
  for (const line of numstat.split('\n')) {
    const [a, d] = line.split('\t')
    if (a === undefined || d === undefined) continue
    add += Number(a) || 0
    del += Number(d) || 0
  }
  return { add, del }
}

const SECRETS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?\S+/gi, '$1$2•••'],
  [/\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'bearer •••'],
  [/\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(--(?:token|password|api-key|secret)[= ])\S+/gi, '$1•••'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
  [/(\bcurl\b[^|;&]*?\s(?:-u|--user)[= ]?[^\s:]+:)\S+/gi, '$1•••'],
  [/(\b(?:sshpass|mysql|mysqldump)\b[^|;&]*?\s-p ?)\S+/gi, '$1•••'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '•••'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '•••'],
  [/([?&](?:key|sig|signature|access_token|api_key|token)=)[^\s&]+/gi, '$1•••'],
  [/(\bcookie\s*:\s*)\S.*/gi, '$1•••'],
]

/** Mask credentials: the card shows commands on screen, and screens get shared. */
export const scrub = (s: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), stripControl(s))

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const text = (v: unknown) => (typeof v === 'string' ? v : '')

/** One line for what a tool call is doing: `$ npm test`, `Edit hooks/lib.ts`. */
export const doing = (tool: string, call: unknown) => {
  const c = isRecord(call) ? call : {}
  const input = isRecord(c.input) ? c.input : c
  if (typeof input.command === 'string') {
    let cmd = input.command.split('\n').find(l => l.trim()) ?? ''
    // A leading `cd dir &&` says nothing about the work.
    for (let prev = ''; prev !== cmd; ) {
      prev = cmd
      cmd = cmd.replace(/^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/, '')
    }
    return scrub(`$ ${cmd.replace(/\s+/g, ' ').trim() || 'cd'}`)
  }
  const path = text(input.file_path || input.notebook_path).split(/[\\/]/).slice(-2).join('/')
  const what = path || text(input.pattern) || text(input.url) || text(input.query) || text(input.description) || text(input.prompt)
  return scrub(what ? `${tool} ${what.replace(/\s+/g, ' ').trim()}` : tool)
}

export const effortLevel = (effort: string) => ({ low: 1, medium: 2, high: 3, xhigh: 4, max: 4 })[effort] ?? 0

/** Rows of the agents section: nothing until one runs, then a rule plus one row per agent. */
export const agentRows = (agents: Agent[]) =>
  agents.some(a => a.status === 'running') ? 1 + Math.min(AGENT_ROWS, agents.length) : 0

/** Running agents first, then the most recent finished ones, capped at what the section can draw. */
export const visibleAgents = (agents: Agent[]) =>
  [...agents.filter(a => a.status === 'running'), ...agents.filter(a => a.status !== 'running').reverse()].slice(0, AGENT_ROWS)

/** Card height for a terminal width: one line when narrow, else the base rows plus agents. */
export const cardRows = (width: number, agents: Agent[]) => (width < NARROW ? 1 : BASE_ROWS + agentRows(agents))

/** Header counts over every tracked agent, not just the rows the card has room to draw. */
export const agentCounts = (agents: Agent[]) => ({ running: agents.filter(a => a.status === 'running').length, total: agents.length })

export const agentStatusFor = (reason: string): AgentStatus =>
  reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'failed'

/** Append, then drop the oldest finished agents first so a live one is never evicted by history. */
export const addAgent = (agents: Agent[], next: Agent): Agent[] => {
  const all = [...agents, next]
  for (let over = all.length - MAX_AGENTS; over > 0; over--) {
    const i = all.findIndex(a => a.status !== 'running')
    all.splice(i === -1 ? 0 : i, 1)
  }
  return all
}

/** `git rev-list --left-right --count @{u}...HEAD` output → commits behind/ahead of upstream. */
export const aheadBehind = (out: string) => {
  const [b, a] = out.trim().split(/\s+/)
  return { behind: Number(b) || 0, ahead: Number(a) || 0 }
}

/** Append a reading, keeping the newest HIST_LEN. */
export const pushHist = (hist: number[], n: number): number[] => [...hist, n].slice(-HIST_LEN)

/** Mark agents that have run past STALE_AGENT_MS as stopped; same array back when nothing changed. */
export const sweepAgents = (agents: Agent[], now: number): Agent[] =>
  agents.some(a => a.status === 'running' && now - a.since > STALE_AGENT_MS)
    ? agents.map(a => (a.status === 'running' && now - a.since > STALE_AGENT_MS ? { ...a, status: 'stopped' as const, endAt: now } : a))
    : agents

export const VERBS = ['open', 'close', 'reset', 'demo'] as const
export const isVerb = (v: string): v is (typeof VERBS)[number] => (VERBS as readonly string[]).includes(v)
