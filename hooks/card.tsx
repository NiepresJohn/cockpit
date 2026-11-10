// The Cockpit card. A surface module is loaded alone, so it takes plain props and imports only types.
// It redraws on the surface's frame clock (spinner, running timers) and sleeps when nothing is moving.
import type { ClientModule } from 'claude-code'

type Meter = { pct: number | null; tail: string; resetsAt?: string | null }
type AgentRow = { name: string; tool: string; doing: string; status: string; since: number; endAt: number | null; steps: number }
type Props = {
  width: number
  now: number
  colors: Record<'accent' | 'cyan' | 'green' | 'purple' | 'amber' | 'red' | 'dim' | 'faint' | 'text', string>
  running: boolean
  model: string
  effort: string
  effortN: number
  repo: string
  branch: string
  add: number
  del: number
  five: Meter
  week: Meter
  ctx: Meter
  hist: number[]
  ascii: boolean
  tools: number
  turns: number
  startedAt: number
  ahead: number
  behind: number
  cost: string
  turnStart: number
  edits: number
  activity: string
  last: string
  agents: AgentRow[]
  agentsRunning: number
  agentsTotal: number
}
type Ref = { p: Props; ticks: number; baseNow: number; baseTick: number }
type State = { ref: Ref }

const TICK_MS = 250
// While idle the clock still counts, but the card redraws only this often (countdowns change by the minute).
const IDLE_REDRAW_TICKS = 240
const NARROW = 64
// Below this the effort gauge goes; at WIDE the bars get room to stretch.
const COMPACT = 84
const WIDE = 110
const LABEL = 5
// Eighths for the partial cell of a bar, and vertical eighths for sparklines.
const EIGHTHS = ' ▏▎▍▌▋▊▉'
const SPARK = '▁▂▃▄▅▆▇█'
const spark = (v: number[], set = SPARK) => v.map(n => set[Math.min(7, Math.max(0, Math.round((n / 100) * 7)))]).join('')
const SPIN = '⣾⣽⣻⢿⡿⣟⣯⣷'
const SPIN_ASCII = '|/-\\'
const GLYPH: Record<string, string> = { done: '✓', failed: '✗', stopped: '■' }

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}
// Same maths as `countdown` in lib.ts (a client module can't import it); keep the two in step.
const countdown = (iso: string | null | undefined, now: number) => {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t) || t <= now) return ''
  const m = Math.floor((t - now) / 60000)
  if (m < 1) return '<1m'
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d${h}h` : h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}
// A bouncing scanner: a bright head with a fading trail, cells of ░▒▓█.
const SCAN_W = 10
const TRAIL = ['█', '▓', '▒', '░']
const TRAIL_ASCII = ['#', '=', '-', '.']
const scanner = (tick: number, ascii = false) => {
  const span = SCAN_W - 1
  const t = tick % (2 * span)
  const right = t < span
  const head = right ? t : 2 * span - t
  const trail = ascii ? TRAIL_ASCII : TRAIL
  const cell = (i: number) => trail[right ? head - i : i - head] ?? (ascii ? ' ' : '·')
  return `[${Array.from({ length: SCAN_W }, (_, i) => cell(i)).join('')}]`
}
const cut = (s: string, n: number) => (n <= 0 ? '' : s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)

const Card: ClientModule<Props, State> = (raw, surface) => {
  // The host half may still be the pre-reload version for a while: default every newer prop.
  const p: Props = { hist: [], ascii: false, tools: 0, turns: 0, startedAt: 0, ahead: 0, behind: 0, ...raw }
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { p, ticks: 0, baseNow: p.now, baseTick: 0 }
  // The frame clock outlives this render: it must read the latest props, never the first.
  ref.p = p
  if (p.now !== ref.baseNow) {
    ref.baseNow = p.now
    ref.baseTick = ref.ticks
  }
  const moving = () => ref.p.running || ref.p.agentsRunning > 0
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(TICK_MS, () => {
      ref.ticks += 1
      if (moving() || ref.ticks % IDLE_REDRAW_TICKS === 0) surface.setState({ ref })
    })
  }

  const C = p.colors
  const W = Math.max(16, surface.columns || p.width)
  const A = p.ascii
  const spinSet = A ? SPIN_ASCII : SPIN
  const spin = spinSet[Math.floor(ref.ticks / (A ? 2 : 1)) % spinSet.length]
  // ASCII mode swaps every block, braille and arrow glyph for a plain stand-in.
  const G = A
    ? { full: '#', empty: '-', eighths: ' ', up: '^', down: 'v', idle: 'o', branch: '@', home: '~', sparkSet: '_.-:=+*#', rule: '-' }
    : { full: '█', empty: '░', eighths: EIGHTHS, up: '↑', down: '↓', idle: '◇', branch: '⎇', home: '⌂', sparkSet: SPARK, rule: '╌' }
  const nowLocal = p.now + (ref.ticks - ref.baseTick) * TICK_MS
  const heat = (v: number) => (v >= 90 ? C.red : v >= 70 ? C.amber : C.green)
  const pctText = (m: Meter) => (m.pct === null ? '—' : `${Math.round(m.pct)}%`)

  if (W < NARROW) {
    return (
      <Box paddingX={2} width={W}>
        <Text wrap="truncate">
          <Text color={C.accent} bold>{p.running ? `${spin} ` : `${G.idle} `}</Text>
          <Text color={C.dim}>{'ctx '}</Text>
          <Text color={p.ctx.pct === null ? C.faint : heat(p.ctx.pct)} bold>{pctText(p.ctx)}</Text>
          <Text color={C.dim}>{' 5h '}</Text>
          <Text color={p.five.pct === null ? C.faint : heat(p.five.pct)} bold>{pctText(p.five)}</Text>
          {W >= 36 ? <Text color={C.dim}>{' 7d '}</Text> : null}
          {W >= 36 ? <Text color={p.week.pct === null ? C.faint : heat(p.week.pct)} bold>{pctText(p.week)}</Text> : null}
          {p.branch && W >= 48 ? <Text color={C.green}>{` ${G.branch} ${p.branch}`}</Text> : null}
        </Text>
      </Box>
    )
  }

  const inner = W - 4
  const colW = Math.floor((inner - 3) / 2)

  // A meter: label, a bar of ▰▱ cells, the percentage, then the tail if it fits.
  const meter = (label: string, m: Meter) => {
    const left = m.resetsAt ? countdown(m.resetsAt, nowLocal) : ''
    const tail = m.resetsAt ? (left ? `↻ ${left}` : '') : m.tail
    const readout = ` ${pctText(m)}`
    const room = colW - LABEL - readout.length
    const withTail = room - (tail ? tail.length + 1 : 0) >= 5
    const barW = Math.max(5, Math.min(W >= WIDE ? 24 : 14, withTail ? room - tail.length - 1 : room))
    const eighths = m.pct === null ? 0 : Math.round((Math.min(100, m.pct) / 100) * barW * 8)
    const full = Math.floor(eighths / 8)
    const part = eighths % 8
    const hot = m.pct !== null && m.pct >= 85 && ref.ticks % 4 < 2
    const cells = Array.from({ length: full }, (_, i) => (
      <Text key={i} color={heat(((i + 1) / barW) * 100)}>{G.full}</Text>
    ))
    return (
      <Text wrap="truncate">
        <Text color={C.dim} bold>{label.padEnd(LABEL)}</Text>
        {cells}
        {part > 0 ? <Text color={heat(((full + 1) / barW) * 100)}>{G.eighths[part]}</Text> : null}
        <Text color={C.faint}>{G.empty.repeat(Math.max(0, barW - full - (part > 0 ? 1 : 0)))}</Text>
        <Text color={m.pct === null ? C.faint : heat(m.pct)} bold={!hot} dimColor={hot}>{readout}</Text>
        {withTail && tail ? <Text dimColor>{` ${tail}`}</Text> : null}
      </Text>
    )
  }

  const pair = (a: ReturnType<typeof meter>, b: ReturnType<typeof meter>) => (
    <Box>
      <Box width={colW} flexShrink={0}>{a}</Box>
      <Text color={C.faint}> │ </Text>
      <Box width={colW} flexShrink={0}>{b}</Box>
    </Box>
  )

  const cost = (
    <Text wrap="truncate">
      <Text color={C.dim} bold>{'COST'.padEnd(LABEL)}</Text>
      <Text color={C.text}>{p.cost}</Text>
      {p.running ? (
        <Text dimColor>{`  ⏱ ${clock(nowLocal - p.turnStart)} · ${p.edits} edit${p.edits === 1 ? '' : 's'}`}</Text>
      ) : p.last ? (
        <Text dimColor>{`  ${p.last}`}</Text>
      ) : null}
      {p.hist.length > 1 && W >= COMPACT ? <Text color={C.purple}>{`  ${spark(p.hist, G.sparkSet)}`}</Text> : null}
    </Text>
  )

  const diff = (p.add > 0 ? 3 + String(p.add).length : 0) + (p.del > 0 ? 3 + String(p.del).length : 0)
  const compact = W < COMPACT
  const roomRight = inner - (compact ? 2 + p.model.length : 2 + p.model.length + 5 + (p.effort || 'think').length + 6) - 1
  const branch = cut(p.branch, Math.max(8, roomRight - diff - 2 - Math.min(p.repo.length, 12) - 4))
  const repo = cut(p.repo, Math.max(8, roomRight - diff - (branch ? 4 + branch.length : 0)))
  const clean = Boolean(p.branch) && p.add === 0 && p.del === 0

  // A bright 4-cell window sweeps over the activity text.
  const shimmer = (txt: string) => {
    const at = ((ref.ticks * 2) % (txt.length + 12)) - 4
    const a = Math.max(0, Math.min(txt.length, at))
    const b = Math.max(a, Math.min(txt.length, at + 4))
    return (
      <Text>
        <Text color={C.dim}>{txt.slice(0, a)}</Text>
        <Text color={C.text} bold>{txt.slice(a, b)}</Text>
        <Text color={C.dim}>{txt.slice(b)}</Text>
      </Text>
    )
  }
  const up = p.startedAt > 0 ? clock(nowLocal - p.startedAt) : ''
  const sync = p.ahead > 0 || p.behind > 0 ? `${G.up}${p.ahead} ${G.down}${p.behind}` : ''
  const stat = (label: string, v: string | number) => (
    <Text>
      <Text color={C.dim}>{`${label} `}</Text>
      <Text color={C.text} bold>{String(v)}</Text>
    </Text>
  )
  const gap = <Text color={C.faint}>{'  ·  '}</Text>
  const stats = (
    <Text wrap="truncate">
      <Text color={C.dim} bold>{'RUN'.padEnd(LABEL)}</Text>
      {stat('tools', p.tools)}
      {gap}
      {stat('turns', p.turns)}
      {W >= COMPACT && up ? gap : null}
      {W >= COMPACT && up ? stat('up', up) : null}
      {sync ? gap : null}
      {sync ? <Text color={p.behind > 0 ? C.amber : C.green}>{sync}</Text> : null}
    </Text>
  )

  const running = p.agentsRunning
  const nameW = Math.min(22, Math.max(10, Math.floor(inner / 4)))

  return (
    <Box flexDirection="column" paddingX={2} width={W}>
      <Box justifyContent="space-between">
        <Text wrap="truncate">
          <Text color={p.running ? C.accent : C.dim}>{p.running ? `${spin} ` : `${G.idle} `}</Text>
          <Text color={C.accent} bold>{p.model}</Text>
          {compact ? null : <Text color={C.faint}>{' ❯ '}</Text>}
          {compact ? null : <Text color={C.purple}>{`✦ ${p.effort || 'think'} `}</Text>}
          {compact ? null : <Text color={C.purple}>{'▮'.repeat(p.effortN)}</Text>}
          {compact ? null : <Text color={C.faint}>{'▯'.repeat(4 - p.effortN)}</Text>}
        </Text>
        {p.repo ? (
          <Text wrap="truncate">
            <Text color={C.cyan}>{`${G.home} ${repo}`}</Text>
            {branch ? <Text color={C.green}>{`  ${G.branch} ${branch}`}</Text> : null}
            {p.add > 0 ? <Text color={C.green} bold>{`  +${p.add}`}</Text> : null}
            {p.del > 0 ? <Text color={C.red} bold>{` −${p.del}`}</Text> : null}
            {clean && !compact ? <Text color={C.faint}>{'  ✓ clean'}</Text> : null}
          </Text>
        ) : null}
      </Box>
      <Text wrap="truncate">
        {p.running ? <Text color={C.accent}>{scanner(ref.ticks, A)}</Text> : null}
        {p.running ? shimmer(` ${cut(p.activity || 'thinking…', Math.max(8, inner - SCAN_W - 3))}`) : null}
        {p.running ? null : <Text color={C.faint}>{`${'·'.repeat(3)} idle`}</Text>}
      </Text>
      <Text wrap="truncate">
        <Text color={C.faint}>{`${G.rule.repeat(3)}┐ `}</Text>
        <Text color={C.dim} bold>{'USAGE'}</Text>
        <Text color={C.faint}>{` ┌${G.rule.repeat(Math.max(0, inner - 12))}`}</Text>
      </Text>
      {pair(meter('5H', p.five), meter('7D', p.week))}
      {pair(meter('CTX', p.ctx), cost)}
      {stats}
      {running > 0 ? (
        <Box flexDirection="column">
          <Text wrap="truncate">
            <Text color={C.faint}>{'╌╌╌┐ '}</Text>
            <Text color={C.cyan} bold>{`AGENTS ${running} running`}</Text>
            <Text color={C.faint}>{p.agentsTotal > running ? ` · ${p.agentsTotal - running} done ┌` : ' ┌'}</Text>
          </Text>
          {p.agents.map((a, i) => {
            const live = a.status === 'running'
            const t = a.since > 0 ? clock((a.endAt ?? nowLocal) - a.since) : '—'
            return (
              <Text key={i} wrap="truncate">
                <Text color={live ? C.cyan : a.status === 'done' ? C.green : C.red}>{`${live ? spin : (GLYPH[a.status] ?? '·')} `}</Text>
                <Text>{cut(a.name, nameW).padEnd(nameW)}</Text>
                <Text dimColor>{` ${t.padStart(5)}  `}</Text>
                <Text color={live ? C.text : C.faint}>{cut(a.doing || (live ? 'thinking…' : ''), Math.max(0, inner - nameW - 12))}</Text>
              </Text>
            )
          })}
        </Box>
      ) : null}
    </Box>
  )
}

export default Card
