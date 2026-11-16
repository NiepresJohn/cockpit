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
export type Where = { repo: string; branch: string; add: number; del: number; untracked: number; ahead: number; behind: number }
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
  where: { repo: '', branch: '', add: 0, del: 0, untracked: 0, ahead: 0, behind: 0 },
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
  dim: '#8089b3',
  faint: '#5a6385',
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
export const FRAME_ROWS = 2 // top and bottom border lines of the animated frame

/** Safe-ish text from stored state: anything not the shape we wrote falls back to the default. */
export const restore = (stored: unknown): State => {
  const s = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>
  const str = (k: keyof State) => (typeof s[k] === 'string' ? (s[k] as string) : (EMPTY[k] as string))
  const num = (k: keyof State) => (typeof s[k] === 'number' && Number.isFinite(s[k]) ? (s[k] as number) : (EMPTY[k] as number))
  const numOrNull = (k: keyof State) => (typeof s[k] === 'number' && Number.isFinite(s[k]) ? (s[k] as number) : null)
  const w = (typeof s.where === 'object' && s.where !== null ? s.where : {}) as Record<string, unknown>
  const wn = (k: keyof Where) => (typeof w[k] === 'number' && Number.isFinite(w[k]) ? (w[k] as number) : 0)
  const rec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
  const STATUSES = ['running', 'done', 'failed', 'stopped']
  return {
    model: str('model'),
    effort: str('effort'),
    running: s.running === true,
    turnStart: num('turnStart'),
    edits: num('edits'),
    activity: str('activity'),
    ctxPct: numOrNull('ctxPct'),
    ctxTokens: numOrNull('ctxTokens'),
    ctxWindow: num('ctxWindow'),
    cost: numOrNull('cost'),
    limits: (Array.isArray(s.limits) ? s.limits : [])
      .filter(l => rec(l) && typeof l.kind === 'string' && typeof l.pct === 'number' && Number.isFinite(l.pct))
      .map(l => ({ kind: l.kind as string, pct: l.pct as number, resetsAt: typeof l.resetsAt === 'string' ? l.resetsAt : null })),
    where: {
      repo: typeof w.repo === 'string' ? w.repo : '',
      branch: typeof w.branch === 'string' ? w.branch : '',
      add: wn('add'),
      del: wn('del'),
      untracked: wn('untracked'),
      ahead: wn('ahead'),
      behind: wn('behind'),
    },
    agents: (Array.isArray(s.agents) ? s.agents : [])
      .filter(a => rec(a) && typeof a.id === 'string' && STATUSES.includes(a.status as string))
      .map(a => ({
        id: a.id as string,
        name: typeof a.name === 'string' ? a.name : '',
        tool: typeof a.tool === 'string' ? a.tool : '',
        doing: typeof a.doing === 'string' ? a.doing : '',
        status: a.status as AgentStatus,
        since: typeof a.since === 'number' ? a.since : 0,
        endAt: typeof a.endAt === 'number' ? a.endAt : null,
        steps: typeof a.steps === 'number' ? a.steps : 0,
        ctx: typeof a.ctx === 'number' ? a.ctx : 0,
      })),
    lastTurn: rec(s.lastTurn) && typeof s.lastTurn.ms === 'number' && typeof s.lastTurn.edits === 'number' ? { ms: s.lastTurn.ms, edits: s.lastTurn.edits } : null,
    hist: Array.isArray(s.hist) ? s.hist.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [],
    tools: num('tools'),
    turns: num('turns'),
    startedAt: num('startedAt'),
  }
}

/** Control bytes (ESC, BEL, C1) would reach the terminal as escape sequences. */
const stripControl = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/g, '')

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

// The lazy patterns below are quadratic; nothing past the display width is ever drawn.
const SCRUB_MAX = 2000

const SECRETS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(?:\w+\s+)?\S+/gi, '$1•••'],
  [/\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'bearer •••'],
  [/\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/\b(?:glpat|ghu|ghr|npm|hf|gsk|whsec|xapp|shpat|dop_v1)[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  // JSON bodies and quoted values: "password":"a b", api_key = 'x y', secret=\"a b\"
  [/((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|pass(?:word|wd|phrase)?|pwd|credentials?)["']?\s*[=:]\s*)(\\?"(?:[^"\\]|\\.)*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(--[\w-]*(?:token|password|passwd|pass|secret|api-?key|passphrase|credential|private-key)[\w-]*[= ])(\\?"(?:[^"\\]|\\.)*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(\b[A-Za-z][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PASSPHRASE|CREDENTIALS?|AUTH)=)(\\?"(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/]*@/gi, '$1•••@'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+@/gi, '$1•••@'],
  [/(\bcurl\b.*?\s(?:-u|--user)[= ]?(?:"[^":]*|'[^':]*|[^\s:"']*):)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(\bcurl\b.*?\s(?:-b|--cookie)[= ]?)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(\b(?:sshpass|mysql|mysqldump|mongosh|sqlcmd|redis-cli|ldapsearch|unzip|docker\s+login|gpg|openssl|htpasswd)\b.*?\s(?:-p|-P|-w|-a|--passphrase|-pass) ?(?:pass:)?)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(\b(?:aws_)?(?:secret_access_key|session_token)\s+)\S+/gi, '$1•••'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '•••'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '•••'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '•••'],
  [/((?:^|[?&])(?:x-amz-)?(?:key|sig|signature|access_token|api_key|token|auth|code|credential|session)=)[^\s&]+/gi, '$1•••'],
  [/(\bcookie\s*:\s*)\S.*/gi, '$1•••'],
]

/** Mask credentials: the card shows commands on screen, and screens get shared. */
export const scrub = (s: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), stripControl(s.slice(0, SCRUB_MAX)))

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const text = (v: unknown) => (typeof v === 'string' ? v : '')

/** One line for what a tool call is doing: `$ npm test`, `Edit hooks/lib.ts`. */
export const doing = (tool: string, call: unknown) => {
  const c = isRecord(call) ? call : {}
  const input = isRecord(c.input) ? c.input : c
  if (typeof input.command === 'string') {
    // Bounded first: a multi-MB command must not stall the hook.
    let cmd = input.command.slice(0, 4000).split('\n').find(l => l.trim()) ?? ''
    // A leading `cd dir &&` says nothing about the work.
    cmd = cmd.replace(/^(?:\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*)+/, '')
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
export const cardRows = (width: number, agents: Agent[]) => (width < NARROW ? 1 : BASE_ROWS + agentRows(agents) + FRAME_ROWS)

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

/** Last path segment; Windows cwds use backslashes, git's own output uses slashes. */
export const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? ''

/** Runs git with the given args in the session folder; resolves '' on any failure. */
export type Git = (...args: string[]) => Promise<string>

/**
 * Repo, branch, uncommitted diff (tracked changes vs HEAD, or index+worktree in a repo with no
 * commit yet), untracked-file count and upstream distance. Outside a repo: the folder name alone.
 */
export const readWhere = async (git: Git, cwd: string): Promise<Where> => {
  const top = await git('rev-parse', '--show-toplevel')
  if (!top) return { ...EMPTY.where, repo: clip(baseName(cwd), 64) }
  const hasHead = (await git('rev-parse', '--verify', '-q', 'HEAD')) !== ''
  const numstat = hasHead
    ? await git('diff', 'HEAD', '--numstat')
    : `${await git('diff', '--cached', '--numstat')}\n${await git('diff', '--numstat')}`
  const untracked = (await git('ls-files', '--others', '--exclude-standard')).split('\n').filter(Boolean).length
  return {
    repo: clip(baseName(top), 64),
    branch: (await git('branch', '--show-current')) || (hasHead ? await git('rev-parse', '--short', 'HEAD') : ''),
    ...diffTotals(numstat),
    untracked,
    ...aheadBehind(await git('rev-list', '--left-right', '--count', '@{u}...HEAD')),
  }
}

/** A usable absolute folder, or ''. Git Bash `/c/x` becomes `C:\x`; shell expansions are refused. */
const cleanDir = (d: string) => {
  if (!d || /[$`*(~]/.test(d)) return ''
  // shortcut: /c/x is read as drive C; a real top-level folder named like one letter on POSIX loses its hint.
  const gb = /^\/([A-Za-z])(?:\/(.*))?$/.exec(d)
  if (gb?.[1]) return `${gb[1].toUpperCase()}:\\${(gb[2] ?? '').replace(/\//g, '\\')}`
  if (/^[A-Za-z]:[\\/]/.test(d)) return d
  if (d.includes('\\')) return ''
  return d.startsWith('/') ? d : ''
}

/** Folder a tool call works in: an absolute file path's folder, or a leading absolute `cd`; else ''. */
export const dirHint = (call: unknown): string => {
  const c = isRecord(call) ? call : {}
  const input = isRecord(c.input) ? c.input : c
  const file = text(input.file_path || input.notebook_path)
  if (/^(?:[A-Za-z]:[\\/]|\/)/.test(file)) {
    const dir = file.replace(/[\\/][^\\/]*$/, '')
    return cleanDir(/^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir || '/')
  }
  const m = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))(?=\s*(?:&&|;|$))/.exec(text(input.command).slice(0, 4000))
  return cleanDir(m?.[1] ?? m?.[2] ?? m?.[3] ?? '')
}
