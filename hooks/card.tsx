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
  untracked: number
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
type Ref = { p: Props; ticks: number; baseNow: number; baseTick: number; prevRunning: boolean; prevAgents: number; flashFrom: number }
type State = { ref: Ref }

const TICK_MS = 250
// While idle the clock still counts, but the card redraws only this often (countdowns change by the minute).
const IDLE_REDRAW_TICKS = 240
const NARROW = 64
const FLASH_TICKS = 16
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
// One-cell ellipsis; the render sets it to a plain ASCII stand-in in ASCII mode.
const ELL = { v: '…' }
const cut = (s: string, n: number) => (n <= 0 ? '' : s.length > n ? `${s.slice(0, Math.max(0, n - 1))}${ELL.v}` : s)

// Colour maths for the animated frame. Non-hex theme colours can't be blended: they snap to the nearer end.
const rgb = (c: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4), 16)]
}
const lerp = (a: string, b: string, t: number) => {
  t = Math.max(0, Math.min(1, t))
  const x = rgb(a)
  const y = rgb(b)
  if (!x || !y) return t < 0.5 ? a : b
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
// A looping gradient: u in [0,1) walks through the stops and back to the first.
const gradient = (stops: string[], u: number) => {
  const n = stops.length
  const f = (((u % 1) + 1) % 1) * n
  const i = Math.floor(f)
  return lerp(stops[i % n], stops[(i + 1) % n], f - i)
}

const Card: ClientModule<Props, State> = (raw, surface) => {
  // The host half may still be the pre-reload version for a while: default every newer prop.
  const p: Props = { hist: [], ascii: false, tools: 0, turns: 0, startedAt: 0, ahead: 0, behind: 0, untracked: 0, ...raw }
  const { Box, Text } = surface.elements
  const ref: Ref = surface.state?.ref ?? { p, ticks: 0, baseNow: p.now, baseTick: 0, prevRunning: p.running, prevAgents: p.agentsRunning, flashFrom: -1e9 }
  // The frame clock outlives this render: it must read the latest props, never the first.
  ref.p = p
  if (p.now !== ref.baseNow) {
    ref.baseNow = p.now
    ref.baseTick = ref.ticks
  }
  // Completion flash: the turn ended or an agent finished since the last render.
  if ((ref.prevRunning && !p.running) || p.agentsRunning < ref.prevAgents) ref.flashFrom = ref.ticks
  ref.prevRunning = p.running
  ref.prevAgents = p.agentsRunning
  const moving = () => ref.p.running || ref.p.agentsRunning > 0 || ref.ticks - ref.flashFrom < FLASH_TICKS
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(TICK_MS, () => {
      ref.ticks += 1
      if (moving() || ref.ticks % IDLE_REDRAW_TICKS === 0) surface.setState({ ref })
    })
  }

  const C = p.colors
  ELL.v = p.ascii ? '~' : '…'
  const FW = Math.max(16, surface.columns || p.width)
  // Wide cards sit inside a 2-column frame; the narrow one-liner stays borderless.
  const W = FW < NARROW ? FW : FW - 2
  const A = p.ascii
  const spinSet = A ? SPIN_ASCII : SPIN
  const spin = spinSet[Math.floor(ref.ticks / (A ? 2 : 1)) % spinSet.length]
  // ASCII mode swaps every block, braille and arrow glyph for a plain stand-in.
  const G = A
    ? { full: '#', empty: '-', eighths: ' =====+=', up: '^', down: 'v', idle: 'o', branch: '@', home: '~', sparkSet: '_.-:=+*#', rule: '-', minus: '-', dot: '.', pipe: '|', on: '#', off: '-', star: '*', chev: '>', clock: 't', reset: '~', check: '+', dash: '-', done: '+', failed: 'x', stopped: '#' }
    : { full: '█', empty: '░', eighths: EIGHTHS, up: '↑', down: '↓', idle: '◇', branch: '⎇', home: '⌂', sparkSet: SPARK, rule: '╌', minus: '−', dot: '·', pipe: '│', on: '▮', off: '▯', star: '✦', chev: '❯', clock: '⏱', reset: '↻', check: '✓', dash: '—', done: '✓', failed: '✗', stopped: '■' }
  const nowLocal = p.now + (ref.ticks - ref.baseTick) * TICK_MS
  const effortN = Math.max(0, Math.min(4, Math.round(p.effortN) || 0))
  const heat = (v: number) => (v >= 90 ? C.red : v >= 70 ? C.amber : C.green)
  const pctText = (m: Meter) => (m.pct === null || !Number.isFinite(m.pct) ? G.dash : `${Math.round(m.pct)}%`)

  if (FW < NARROW) {
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
          {W >= 48 && p.add > 0 ? <Text color={C.green}>{` +${p.add}`}</Text> : null}
          {W >= 48 && p.del > 0 ? <Text color={C.red}>{` ${G.minus}${p.del}`}</Text> : null}
        </Text>
      </Box>
    )
  }

  const inner = W - 2
  const colW = Math.floor((inner - 3) / 2)

  // A meter: label, a bar of ▰▱ cells, the percentage, then the tail if it fits.
  const meter = (label: string, m: Meter) => {
    const left = m.resetsAt ? countdown(m.resetsAt, nowLocal) : ''
    const tail = m.resetsAt ? (left ? `${G.reset} ${left}` : '') : m.tail
    const readout = ` ${pctText(m)}${m.pct !== null && m.pct >= 90 ? '!' : ''}`
    const room = colW - LABEL - readout.length
    const withTail = room - (tail ? tail.length + 1 : 0) >= 5
    const barW = Math.max(5, Math.min(W >= WIDE ? 24 : 14, withTail ? room - tail.length - 1 : room))
    const eighths = m.pct === null ? 0 : Math.round((Math.min(100, m.pct) / 100) * barW * 8)
    const full = Math.floor(eighths / 8)
    const part = eighths % 8
    const cells = Array.from({ length: full }, (_, i) => (
      <Text key={i} color={heat(((i + 1) / barW) * 100)}>{G.full}</Text>
    ))
    return (
      <Text wrap="truncate">
        <Text color={C.dim} bold>{label.padEnd(LABEL)}</Text>
        {cells}
        {part > 0 ? <Text color={heat(((full + 1) / barW) * 100)}>{G.eighths[part]}</Text> : null}
        <Text color={C.faint}>{G.empty.repeat(Math.max(0, barW - full - (part > 0 ? 1 : 0)))}</Text>
        <Text color={m.pct === null ? C.faint : heat(m.pct)} bold>{readout}</Text>
        {withTail && tail ? <Text color={C.dim}>{` ${tail}`}</Text> : null}
      </Text>
    )
  }

  const pair = (a: ReturnType<typeof meter>, b: ReturnType<typeof meter>) => (
    <Box>
      <Box width={colW} flexShrink={0}>{a}</Box>
      <Text color={C.faint}>{` ${G.pipe} `}</Text>
      <Box width={colW} flexShrink={0}>{b}</Box>
    </Box>
  )

  const cost = (
    <Text wrap="truncate">
      <Text color={C.dim} bold>{'COST'.padEnd(LABEL)}</Text>
      <Text color={C.text}>{p.cost}</Text>
      {p.running ? (
        <Text color={C.dim}>{`  ${G.clock} ${clock(nowLocal - p.turnStart)} ${G.dot} ${p.edits} edit${p.edits === 1 ? '' : 's'}`}</Text>
      ) : p.last ? (
        <Text color={C.dim}>{`  ${p.last.replace('✓', G.check).replace('·', G.dot)}`}</Text>
      ) : null}
      {p.hist.length > 1 && W >= COMPACT ? <Text color={C.dim}>{'  ctx '}</Text> : null}
      {p.hist.length > 1 && W >= COMPACT ? <Text color={C.purple}>{spark(p.hist, G.sparkSet)}</Text> : null}
    </Text>
  )

  const diff = (p.add > 0 ? 3 + String(p.add).length : 0) + (p.del > 0 ? 3 + String(p.del).length : 0) + (p.untracked > 0 ? 3 + String(p.untracked).length : 0)
  const compact = W < COMPACT
  const roomRight = inner - (compact ? 2 + p.model.length : 2 + p.model.length + 5 + (p.effort || 'think').length + 6) - 1
  const branch = cut(p.branch, Math.max(8, roomRight - diff - 2 - Math.min(p.repo.length, 12) - 4))
  const repo = cut(p.repo, Math.max(8, roomRight - diff - (branch ? 4 + branch.length : 0)))
  const clean = Boolean(p.branch) && p.add === 0 && p.del === 0 && p.untracked === 0

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
  const gap = <Text color={C.faint}>{`  ${G.dot}  `}</Text>
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

  const body = (
    <Box flexDirection="column" paddingX={1} width={W} flexShrink={0}>
      <Box justifyContent="space-between">
        <Text wrap="truncate">
          <Text color={p.running ? C.accent : C.dim}>{p.running ? `${spin} ` : `${G.idle} `}</Text>
          <Text color={C.accent} bold>{p.model}</Text>
          {compact ? null : <Text color={C.faint}>{` ${G.chev} `}</Text>}
          {compact ? null : <Text color={C.purple}>{`${G.star} ${p.effort || 'think'} `}</Text>}
          {compact ? null : <Text color={C.purple}>{G.on.repeat(effortN)}</Text>}
          {compact ? null : <Text color={C.faint}>{G.off.repeat(4 - effortN)}</Text>}
        </Text>
        {p.repo ? (
          <Text wrap="truncate">
            <Text color={C.cyan}>{`${G.home} ${repo}`}</Text>
            {branch ? <Text color={C.text}>{`  ${G.branch} ${branch}`}</Text> : null}
            {p.add > 0 ? <Text color={C.green} bold>{`  +${p.add}`}</Text> : null}
            {p.del > 0 ? <Text color={C.red} bold>{` ${G.minus}${p.del}`}</Text> : null}
            {p.untracked > 0 ? <Text color={C.amber}>{`  ?${p.untracked}`}</Text> : null}
            {clean && !compact ? <Text color={C.faint}>{`  ${G.check}`}</Text> : null}
          </Text>
        ) : null}
      </Box>
      <Text wrap="truncate">
        {p.running ? <Text color={C.accent}>{scanner(ref.ticks, A)}</Text> : null}
        {p.running ? shimmer(` ${cut(p.activity || `thinking${ELL.v}`, Math.max(8, inner - SCAN_W - 3))}`) : null}
        {p.running ? null : <Text color={C.faint}>{`${G.dot.repeat(3)} idle`}</Text>}
      </Text>
      <Text wrap="truncate">
        <Text color={C.faint}>{`${G.rule.repeat(3)} `}</Text>
        <Text color={C.dim} bold>{'USAGE'}</Text>
        <Text color={C.faint}>{` ${G.rule.repeat(Math.max(0, inner - 12))}`}</Text>
      </Text>
      {pair(meter('5H', p.five), meter('7D', p.week))}
      {pair(meter('CTX', p.ctx), cost)}
      {stats}
      {running > 0 ? (
        <Box flexDirection="column">
          <Text wrap="truncate">
            <Text color={C.faint}>{`${G.rule.repeat(3)} `}</Text>
            <Text color={C.cyan} bold>{`AGENTS ${running} running`}</Text>
            <Text color={C.faint}>{`${p.agentsTotal > running ? ` ${G.dot} ${p.agentsTotal - running} finished` : ''} ${G.rule.repeat(Math.max(0, inner - 24))}`}</Text>
          </Text>
          {p.agents.slice(0, 6).map((a, i) => {
            const live = a.status === 'running'
            const t = a.since > 0 ? clock((a.endAt ?? nowLocal) - a.since) : G.dash
            return (
              <Text key={i} wrap="truncate">
                <Text color={live ? C.cyan : a.status === 'done' ? C.green : a.status === 'stopped' ? C.amber : C.red}>{`${live ? spin : (G[a.status as 'done' | 'failed' | 'stopped'] ?? G.dot)} `}</Text>
                <Text color={a.status === 'failed' ? C.red : a.status === 'done' ? C.dim : C.text}>{cut(a.name, nameW).padEnd(nameW)}</Text>
                <Text color={C.dim}>{` ${t.padStart(5)}  `}</Text>
                <Text color={live ? C.text : a.status === 'failed' ? C.red : C.dim}>{cut(a.doing || (live ? `thinking${ELL.v}` : ''), Math.max(0, inner - nameW - 12))}</Text>
              </Text>
            )
          })}
        </Box>
      ) : null}
    </Box>
  )

  // ---- Animated frame -------------------------------------------------------------------------------------------
  const warn = Math.max(p.ctx.pct ?? 0, p.five.pct ?? 0, p.week.pct ?? 0)
  const warnColor = warn >= 90 ? C.red : warn >= 70 ? C.amber : ''
  const base = warnColor || (p.running ? C.accent : C.faint)
  const rows = 6 + (running > 0 ? 1 + Math.min(6, p.agents.length) : 0)
  const P = 2 * FW + 2 * rows
  const t = ref.ticks
  const flash = Math.max(0, 1 - (t - ref.flashFrom) / FLASH_TICKS)
  const breathe = 0.55 + 0.45 * Math.sin(t * 0.18)
  const head = (t * 1.5) % P
  // Colour of perimeter cell idx (clockwise from the top-left corner).
  const cellColor = (idx: number) => {
    let c = base
    if (p.running) {
      const stops = warnColor ? [warnColor, lerp(warnColor, C.text, 0.4), warnColor] : [C.accent, C.purple, C.cyan]
      const wave = gradient(stops, idx / P - t * 0.015)
      c = lerp(base, wave, breathe)
      const d = (((head - idx) % P) + P) % P
      if (d < 7) c = lerp(C.text, c, d / 7)
    }
    return flash > 0 ? lerp(c, C.green, flash) : c
  }
  const chars = A ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', dot: '*' } : { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', dot: '●' }
  const edge = (len: number, idxOf: (c: number) => number, left: string, right: string, label: string, dots: number[]) => {
    const cells = []
    for (let c = 0; c < len; c++) {
      const isLabel = c >= 3 && c < 3 + label.length
      const isDot = dots.includes(c)
      const ch = c === 0 ? left : c === len - 1 ? right : isDot ? chars.dot : isLabel ? label[c - 3] : chars.h
      const color = isDot ? C.cyan : isLabel ? (p.running ? C.text : C.dim) : cellColor(idxOf(c))
      cells.push(<Text key={c} color={color} bold={isLabel || isDot}>{ch}</Text>)
    }
    return <Text wrap="truncate">{cells}</Text>
  }
  const topLabel = ' cockpit '
  const botLabel = running > 0 ? ` ${running} agent${running === 1 ? '' : 's'} ` : p.running ? ' working ' : ' idle '
  // Each running agent is a dot sliding along the bottom edge, clear of the label.
  const dotFrom = 3 + botLabel.length + 1
  const dotSpan = FW - 1 - dotFrom
  const dots = dotSpan > 0 ? p.agents.filter(a => a.status === 'running').slice(0, 6).map((_, i) => dotFrom + ((t * (1 + (i % 3)) + i * 9) % dotSpan)) : []
  const side = (idxOf: (r: number) => number) => (
    <Box flexDirection="column" width={1} flexShrink={0}>
      {Array.from({ length: rows }, (_, r) => <Text key={r} color={cellColor(idxOf(r))} bold>{chars.v}</Text>)}
    </Box>
  )
  return (
    <Box flexDirection="column" width={FW}>
      {edge(FW, c => c, chars.tl, chars.tr, topLabel, [])}
      <Box>
        {side(r => P - 1 - r)}
        {body}
        {side(r => FW + r)}
      </Box>
      {edge(FW, c => FW + rows + (FW - 1 - c), chars.bl, chars.br, botLabel, dots)}
    </Box>
  )
}

export default Card
