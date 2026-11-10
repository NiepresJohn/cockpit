import { expect, test } from 'claude-code/testing'

import { isVerb, aheadBehind, pushHist, HIST_LEN, agentCounts, MAX_AGENTS, STALE_AGENT_MS, addAgent, sweepAgents, agentRows, agentStatusFor, cardRows, clip, clock, compact, countdown, crossed, diffTotals, doing, findWindow, modelName, restore, scrub, usd, visibleAgents, windowLabel } from '../hooks/lib'
import type { Agent } from '../hooks/lib'

const agent = (over: Partial<Agent>): Agent => ({ id: 'a', name: 'n', tool: '', doing: '', status: 'running', since: 0, endAt: null, steps: 0, ctx: 0, ...over })

test('modelName reads current, dated, provider-prefixed and old ids', () => {
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(modelName('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
  expect(modelName('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  expect(modelName('')).toBe('—')
})

test('formatters', () => {
  expect(clock(65_000)).toBe('1:05')
  expect(clock(3_725_000)).toBe('1h02')
  expect(compact(1_500_000)).toBe('1.5M')
  expect(compact(42_000)).toBe('42k')
  expect(usd(3.456)).toBe('$3.46')
  expect(usd(120.4)).toBe('$120')
  expect(clip('a  b   c', 20)).toBe('a b c')
  expect(clip('abcdefghij', 5)).toBe('abcd…')
})

test('countdown is empty for unknown or past instants', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  expect(countdown(null, now)).toBe('')
  expect(countdown('2025-12-31T00:00:00Z', now)).toBe('')
  expect(countdown('2026-01-01T00:00:30Z', now)).toBe('<1m')
  expect(countdown('2026-01-01T02:14:00Z', now)).toBe('2h14m')
  expect(countdown('2026-01-04T04:00:00Z', now)).toBe('3d4h')
})

test('crossed ignores the first reading and reports the highest mark climbed', () => {
  expect(crossed(undefined, 99)).toBe(null)
  expect(crossed(80, 90)).toBe(85)
  expect(crossed(80, 96)).toBe(95)
  expect(crossed(86, 90)).toBe(null)
})

test('limits are found and labelled by kind', () => {
  const limits = [{ kind: 'five_hour', pct: 10, resetsAt: null }, { kind: 'seven_day', pct: 20, resetsAt: null }]
  expect(findWindow(limits, 'five')?.pct).toBe(10)
  expect(findWindow(limits, 'seven')?.pct).toBe(20)
  expect(windowLabel('seven_day_opus')).toBe('7d opus')
})

test('diffTotals sums numstat and treats binary files as zero', () => {
  expect(diffTotals('3\t1\ta.ts\n-\t-\timg.png\n2\t0\tb.ts')).toEqual({ add: 5, del: 1 })
  expect(diffTotals('')).toEqual({ add: 0, del: 0 })
})

test('doing drops a leading cd and masks credentials', () => {
  expect(doing('Bash', { input: { command: 'cd /x && npm test' } })).toBe('$ npm test')
  expect(doing('Edit', { input: { file_path: '/a/b/c.ts' } })).toBe('Edit b/c.ts')
  expect(doing('Bash', { input: { command: 'curl -H "Authorization: Bearer abcdefghijkl"' } })).not.toContain('abcdefghijkl')
  expect(scrub('API_KEY=hunter2')).toBe('API_KEY=•••')
})

test('agent rows appear only while one runs, running first', () => {
  const done = agent({ id: 'd', status: 'done' })
  const live = agent({ id: 'l' })
  expect(agentRows([done])).toBe(0)
  expect(agentRows([done, live])).toBe(3)
  expect(visibleAgents([done, live]).map(a => a.id)).toEqual(['l', 'd'])
  expect(cardRows(100, [done, live])).toBe(9)
  expect(cardRows(50, [done, live])).toBe(1)
  expect(agentStatusFor('answer')).toBe('done')
  expect(agentStatusFor('aborted')).toBe('stopped')
  expect(agentStatusFor('error')).toBe('failed')
})

test('restore survives garbage', () => {
  expect(restore(undefined).agents).toEqual([])
  expect(restore({ agents: 'x', limits: 5 }).limits).toEqual([])
  expect(restore({ model: 'm' }).model).toBe('m')
})

test('agent list stays bounded over a very long session', () => {
  let agents: Agent[] = []
  for (let i = 0; i < 10_000; i++) agents = addAgent(agents, agent({ id: `a${i}`, status: i % 3 ? 'done' : 'running' }))
  expect(agents.length).toBe(MAX_AGENTS)
  expect(agents[agents.length - 1]?.id).toBe('a9999')
})

test('addAgent never evicts a running agent for a finished one', () => {
  const live = agent({ id: 'live', since: 1 })
  let agents = [live]
  for (let i = 0; i < 100; i++) agents = addAgent(agents, agent({ id: `d${i}`, status: 'done' }))
  expect(agents.some(a => a.id === 'live')).toBe(true)
  expect(agents.length).toBe(MAX_AGENTS)
})

test('sweepAgents stops agents that never reported back, keeps fresh and finished ones', () => {
  const now = 10 * STALE_AGENT_MS
  const stale = agent({ id: 's', since: 1 })
  const fresh = agent({ id: 'f', since: now - 1000 })
  const done = agent({ id: 'd', status: 'done', since: 1, endAt: 5 })
  const out = sweepAgents([stale, fresh, done], now)
  expect(out.map(a => [a.id, a.status])).toEqual([['s', 'stopped'], ['f', 'running'], ['d', 'done']])
  expect(out[0]?.endAt).toBe(now)
  const same = [fresh, done]
  expect(sweepAgents(same, now)).toBe(same)
})

test('clock and countdown hold up after days', () => {
  expect(clock(100 * 3_600_000 + 5 * 60_000)).toBe('100h05')
  expect(clock(-5)).toBe('0:00')
  expect(countdown('2026-01-30T00:00:00Z', Date.parse('2026-01-01T00:00:00Z'))).toBe('29d0h')
})

test('scrub masks url credentials, cli flags and env secrets', () => {
  expect(scrub('git clone https://me:pw123@host/x')).toBe('git clone https://me:•••@host/x')
  expect(scrub('tool --token abc123 run')).toBe('tool --token ••• run')
  expect(scrub('GH_TOKEN=ghp_abcdefghijkl1234 x')).not.toContain('abcdefghijkl')
  expect(scrub('max_tokens=5')).toBe('max_tokens=5')
})

test('misc edges: clip, compact, doing on odd input, restore keeps partial where', () => {
  expect(clip('abc', 0)).toBe('')
  expect(compact(999)).toBe('999')
  expect(doing('Read', null)).toBe('Read')
  expect(doing('Grep', { input: { pattern: 'foo' } })).toBe('Grep foo')
  expect(restore({ where: { repo: 'r' } }).where).toEqual({ repo: 'r', branch: '', add: 0, del: 0, ahead: 0, behind: 0 })
  expect(modelName('totally-unknown-model-id-that-is-long')).toBe('totally-unknown-model…')
})

test('agent header counts cover every agent, not only the visible rows', () => {
  const many = Array.from({ length: 10 }, (_, i) => agent({ id: `r${i}` })).concat(agent({ id: 'd', status: 'done' }))
  expect(visibleAgents(many).length).toBe(6)
  expect(agentCounts(many)).toEqual({ running: 10, total: 11 })
  expect(agentCounts([])).toEqual({ running: 0, total: 0 })
})

test('pushHist keeps the newest HIST_LEN readings; restore drops junk history', () => {
  const long = Array.from({ length: HIST_LEN + 5 }, (_, i) => i)
  expect(pushHist(long, 99)).toHaveLength(HIST_LEN)
  expect(pushHist([1], 2)).toEqual([1, 2])
  expect(restore({ hist: [1, 'x', 3] }).hist).toEqual([1, 3])
})

test('aheadBehind parses rev-list counts and tolerates empty output', () => {
  expect(aheadBehind('3\t2')).toEqual({ behind: 3, ahead: 2 })
  expect(aheadBehind('')).toEqual({ behind: 0, ahead: 0 })
})

test('isVerb accepts only the documented verbs', () => {
  for (const v of ['open', 'close', 'reset', 'demo']) expect(isVerb(v)).toBe(true)
  expect(isVerb('bogus')).toBe(false)
})

test('findWindow prefers the plain window over a per-model one listed first', () => {
  const limits = [{ kind: 'seven_day_opus', pct: 99, resetsAt: null }, { kind: 'seven_day', pct: 20, resetsAt: null }]
  expect(findWindow(limits, 'seven')?.pct).toBe(20)
})

test('clip strips terminal control bytes', () => {
  expect(clip('a\x1b]0;pwned\x07b\x1b[2Jc', 40)).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/)
  expect(doing('Bash', { input: { command: 'echo \x1b[2J hi' } })).not.toContain('\x1b')
})

test('scrub masks basic-auth flags, db passwords, cloud and URL credentials', () => {
  for (const [raw, secret] of [
    ['curl -u admin:hunter2 https://x.io', 'hunter2'],
    ['sshpass -p hunter2 ssh host', 'hunter2'],
    ['mysql -pSecret123 db', 'Secret123'],
    ['aws AKIAABCDEFGHIJKLMNOP', 'AKIAABCDEFGHIJKLMNOP'],
    ['x eyJhbGciOi.eyJzdWIiOi.abc123def', 'eyJhbGciOi'],
    ['curl https://x.io/?key=abc12345&a=1', 'abc12345'],
    ['curl -H "Cookie: sid=zzz999"', 'zzz999'],
  ]) expect(scrub(raw)).not.toContain(secret)
  expect(scrub('git commit -m ok')).toBe('git commit -m ok')
})
