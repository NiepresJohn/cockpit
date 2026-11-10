import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  BASE_ROWS,
  COLORS,
  EDIT_TOOLS,
  EMPTY,
  addAgent,
  agentCounts,
  agentRows,
  agentStatusFor,
  aheadBehind,
  isVerb,
  VERBS,
  cardRows,
  clip,
  clock,
  compact,
  countdown,
  crossed,
  diffTotals,
  doing,
  effortLevel,
  findWindow,
  modelName,
  pushHist,
  restore,
  sweepAgents,
  usd,
  visibleAgents,
  windowLabel,
} from './lib'
import type { Agent, State, Where } from './lib'

const PANE = 'cockpit'
const PANE_COLUMNS = 66

const store = atom({ plugin: 'cockpit', key: 'state' } as const, EMPTY)

const load = async ($: EngineInterface) => restore(await read($, store))
const patch = ($: EngineInterface, f: (s: State) => Partial<State>) =>
  update($, store, raw => {
    const s = restore(raw)
    const changes = f(s)
    // Nothing to change: hand back the same state so nothing redraws.
    return Object.keys(changes).length === 0 ? raw : { ...s, ...changes }
  })
const patchAgent = ($: EngineInterface, id: string, f: (a: Agent) => Partial<Agent>) =>
  patch($, s => ({ agents: s.agents.map(a => (a.id === id ? { ...a, ...f(a) } : a)) }))

// ---------------------------------------------------------------- pane

let isPlaced = false
// Set by `/cockpit close`: automatic reopening (turn start, agent growth) must respect it.
let closedByUser = false
let shownRows = BASE_ROWS

async function openPane($: EngineInterface, rows = shownRows) {
  // `columns` applies when docked beside the transcript, `rows` when seated inline above the prompt.
  const opened = await $.ui.open({ id: PANE, title: 'Cockpit', columns: PANE_COLUMNS, rows })
  isPlaced = opened.isPlaced
  closedByUser = false
  return opened
}

/** The pane grows while agents run; reopen it only when the row count really changed. */
async function fitPane($: EngineInterface) {
  const rows = BASE_ROWS + agentRows((await load($)).agents)
  if (rows === shownRows) return
  shownRows = rows
  if (isPlaced && !closedByUser) await openPane($, rows).catch(() => undefined)
}

// ---------------------------------------------------------------- reads from the machine

/** Repo, branch and uncommitted diff of the folder the session is in now; outside a repo, the folder name. */
let probing = false
let probeAgain: string | undefined | null = null

/** Coalesce bursts (every Bash call and edit probes): one git round at a time, one rerun for the latest ask. */
async function probeWhere($: EngineInterface, at?: string) {
  if (probing) {
    probeAgain = at
    return
  }
  probing = true
  try {
    await probeOnce($, at)
  } finally {
    probing = false
  }
  if (probeAgain !== null) {
    const next = probeAgain
    probeAgain = null
    await probeWhere($, next)
  }
}

async function probeOnce($: EngineInterface, at?: string) {
  const cwd = at ?? (await $.session.cwd().catch(() => ''))
  const git = async (...args: string[]) => {
    const r = await $.process.run(['git', ...args], { cwd: cwd || undefined, timeoutMs: 3000 }).catch(() => null)
    return r && r.exitCode === 0 ? r.stdout.trim() : ''
  }
  const top = await git('rev-parse', '--show-toplevel')
  const where: Where = top
    ? {
        repo: top.split('/').pop() ?? '',
        branch: (await git('branch', '--show-current')) || (await git('rev-parse', '--short', 'HEAD')),
        ...diffTotals(await git('diff', 'HEAD', '--numstat')),
        ...aheadBehind(await git('rev-list', '--left-right', '--count', '@{u}...HEAD')),
      }
    : { repo: cwd.split('/').filter(Boolean).pop() ?? '', branch: '', add: 0, del: 0, ahead: 0, behind: 0 }
  await patch($, s => (JSON.stringify(s.where) === JSON.stringify(where) ? {} : { where }))
}

const sessionCost = async ($: EngineInterface) => (await $.session.usage().catch(() => null))?.cost?.usd ?? null

type Reading = {
  context: { percent?: number | null; tokens?: number | null; window: number }
  cost?: { usd?: number | null } | null
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string | null }[]
}
const readingToState = (u: Reading): Partial<State> => ({
  ctxPct: u.context.percent ?? null,
  ctxTokens: u.context.tokens ?? null,
  ctxWindow: u.context.window,
  cost: u.cost?.usd ?? null,
  limits: u.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed, resetsAt: r.resetsAt ?? null })),
})

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  const openOnStart = options.openOnStart !== false
  const ascii = options.ascii === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cockpit',
      description: 'Cockpit, the live session card: open, close or reset it',
      argumentHint: '[open|close|reset|demo]',
    })
    // A host without usage (headless, an SDK host, a session not yet bound) just starts without it.
    const u = await $.session.usage().catch(() => null)
    if (u) await patch($, () => readingToState(u))
    const started = await $.clock.now()
    await patch($, s => (s.startedAt > 0 ? {} : { startedAt: started }))
    void probeWhere($)
    if (openOnStart) void openPane($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // After /clear the old gauge would lie until the next measurement.
    if (e.reason === 'clear') await patch($, s => ({ ...EMPTY, model: s.model, where: s.where, limits: s.limits, cost: s.cost }))
    return next(e)
  })

  on('command.run', { command: 'cockpit' }, async ($, e) => {
    const verb = e.args.trim().split(/\s+/)[0] || 'open'
    if (!isVerb(verb)) return { text: `Unknown option "${verb}". Usage: /cockpit [${VERBS.join('|')}]` }
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      closedByUser = true
      isPlaced = false
      return { text: 'Cockpit closed.' }
    }
    if (verb === 'demo') {
      const now = await $.clock.now()
      const iso = (mins: number) => new Date(now + mins * 60000).toISOString()
      const agent = (id: string, name: string, status: Agent['status'], doing: string, ago: number): Agent => ({
        id, name, tool: 'Bash', doing, status, since: now - ago * 1000, endAt: status === 'running' ? null : now - 5000, steps: 7, ctx: 40000,
      })
      await patch($, () => ({
        model: 'claude-opus-5-5[1m]', effort: 'xhigh', running: true, turnStart: now - 95000, edits: 4,
        activity: '$ pnpm test --filter web', ctxPct: 88, ctxTokens: 880000, ctxWindow: 1000000, cost: 12.34,
        limits: [
          { kind: 'five_hour', pct: 72, resetsAt: iso(134) },
          { kind: 'seven_day', pct: 91, resetsAt: iso(3 * 1440 + 240) },
        ],
        where: { repo: 'my-app', branch: 'feat/search', add: 128, del: 37, ahead: 2, behind: 1 },
        agents: [
          agent('d1', 'code-reviewer', 'running', 'Read src/components/Search.tsx', 62),
          agent('d2', 'security-reviewer', 'running', '$ grep -rn userId', 41),
          agent('d3', 'tdd-guide', 'done', 'all 14 tests green', 120),
          agent('d4', 'e2e-runner', 'failed', 'timeout waiting for :5000', 90),
        ],
        lastTurn: { ms: 83000, edits: 3 }, hist: [22, 30, 41, 38, 55, 63, 70, 74, 81, 88], tools: 142, turns: 17, startedAt: now - 4320000,
      }))
      await fitPane($)
      return { text: 'Cockpit demo loaded (fake data). /cockpit reset to clear; the next real event overwrites parts of it.' }
    }
    if (verb === 'reset') {
      await patch($, s => ({ ...EMPTY, model: s.model, where: s.where }))
      return { text: 'Cockpit reset.' }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Cockpit opened.' : `Cockpit is not shown yet: ${opened.reason}` }
  })

  // A `cd` in a Bash call or a worktree switch moves the session; re-read repo, branch and diff there.
  on('classic.CwdChanged', async ($, e, next) => {
    void probeWhere($, e.new_cwd)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    void probeWhere($)
    if (openOnStart && !isPlaced && !closedByUser) void openPane($).catch(() => undefined)
    const now = await $.clock.now()
    await patch($, s => ({ running: true, turnStart: now, edits: 0, activity: '', agents: sweepAgents(s.agents, now) }))
    await fitPane($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      await patch($, s => (s.model === e.model && s.effort === String(e.effort ?? '') ? {} : { model: e.model, effort: String(e.effort ?? '') }))
      return yield* next(e)
    }
    const result = yield* next(e)
    const u = result.usage ?? {}
    const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    await patchAgent($, e.agentId, a => ({ steps: a.steps + 1, ctx: ctx > 0 ? ctx : a.ctx }))
    return result
  })

  on('session.measure', async ($, e, next) => {
    const before = (await load($)).limits
    const now = await $.clock.now()
    for (const r of e.rateLimits) {
      if (crossed(before.find(l => l.kind === r.kind)?.pct, r.percentUsed) === null) continue
      const reset = countdown(r.resetsAt, now)
      await $.ui.toast(`${windowLabel(r.kind)} limit ${Math.round(r.percentUsed)}%${reset ? ` · resets in ${reset}` : ''}`)
    }
    await patch($, () => readingToState(e))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const line = clip(doing(tool, e), 56)
    if (tool !== 'SubagentHandback') {
      if (e.agentId) await patchAgent($, e.agentId, () => ({ tool, doing: line }))
      else await patch($, () => ({ activity: line }))
    }
    const ran = await next(e)
    const didRun = ran.deny === undefined
    const isEdit = didRun && ran.isError !== true && EDIT_TOOLS.has(tool)
    if (didRun && tool !== 'SubagentHandback') await patch($, s => ({ tools: s.tools + 1 }))
    if (isEdit) await patch($, s => ({ edits: s.edits + 1 }))
    if (isEdit || tool === 'Bash') void probeWhere($)
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || !started.agentId) return started
    const agent: Agent = {
      id: started.agentId,
      name: clip(e.description || e.name || e.subagentType, 40),
      tool: '',
      doing: '',
      status: 'running',
      since: await $.clock.now(),
      endAt: null,
      steps: 0,
      ctx: 0,
    }
    await patch($, s => ({ agents: addAgent(s.agents, agent) }))
    await fitPane($)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const now = await $.clock.now()
    if (!e.agentId) {
      await patch($, s => ({ running: false, activity: '', lastTurn: { ms: e.durationMs, edits: s.edits }, turns: s.turns + 1, hist: s.ctxPct === null ? s.hist : pushHist(s.hist, s.ctxPct) }))
      const cost = await sessionCost($)
      if (cost !== null) await patch($, () => ({ cost }))
    } else {
      const id = e.agentId
      await patchAgent($, id, a => (a.status === 'running' ? { status: agentStatusFor(e.reason), endAt: now, ...(e.answer ? { doing: clip(e.answer, 64) } : {}) } : {}))
    }
    await fitPane($)
    return done
  })

  // ---------------------------------------------------------------- drawing

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [s, now] = await Promise.all([load($), $.clock.now()])
    const W = Math.max(16, e.props.bodyColumns)
    const model = modelName(s.model)
    const five = findWindow(s.limits, 'five')
    const week = findWindow(s.limits, 'seven')

    // Hosts without client modules (no animation clock) get a static one-liner.
    if (!('Client' in els)) {
      const pct = (p?: number | null) => (p == null ? '—' : `${Math.round(p)}%`)
      return (
        <Box width={W}>
          <Text wrap="truncate">
            {`${s.running ? '◆' : '◇'} ${model}  ctx ${pct(s.ctxPct)}  5h ${pct(five?.pct)}  7d ${pct(week?.pct)}${s.cost !== null ? `  ${usd(s.cost)}` : ''}${s.where.branch ? `  ⎇ ${clip(s.where.branch, 24)}` : ''}`}
          </Text>
        </Box>
      )
    }

    const left = s.ctxTokens !== null && s.ctxWindow > 0 ? `${compact(Math.max(0, s.ctxWindow - s.ctxTokens))} left` : ''
    const counts = agentCounts(s.agents)
    const last = s.lastTurn && !s.running ? `✓ ${clock(s.lastTurn.ms)} · ${s.lastTurn.edits} edit${s.lastTurn.edits === 1 ? '' : 's'}` : ''
    return (
      <els.Client
        key="card"
        module="./card.tsx"
        width={W}
        height={cardRows(W, s.agents)}
        props={{
          width: W,
          now,
          colors: COLORS,
          running: s.running,
          model,
          effort: s.effort,
          effortN: effortLevel(s.effort),
          repo: s.where.repo,
          branch: clip(s.where.branch, 24),
          add: s.where.add,
          del: s.where.del,
          five: { pct: five?.pct ?? null, tail: '', resetsAt: five?.resetsAt ?? null },
          week: { pct: week?.pct ?? null, tail: '', resetsAt: week?.resetsAt ?? null },
          ctx: { pct: s.ctxPct, tail: left },
          hist: s.hist,
          ascii,
          tools: s.tools,
          turns: s.turns,
          startedAt: s.startedAt,
          ahead: s.where.ahead,
          behind: s.where.behind,
          cost: s.cost !== null ? usd(s.cost) : '—',
          turnStart: s.turnStart,
          edits: s.edits,
          activity: s.running ? s.activity : '',
          last,
          agents: visibleAgents(s.agents),
          agentsRunning: counts.running,
          agentsTotal: counts.total,
        }}
      />
    )
  })
}
