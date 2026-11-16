// Run: bun tests/render-check.ts  (fake-surface render of the card; prints ASCII LEAK lines if any)
// @ts-nocheck
import Card from '../hooks/card.tsx'
;(globalThis as any).h = (type: any, props: any, ...kids: any[]) => ({ type, props, kids })
const txt = (n: any): string => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(txt).join('') : txt(n.kids) + txt(n.props && n.props.children)
const agent = (status: string) => ({ id: status, name: 'rev', tool: '', doing: 'doing it', status, since: 0, endAt: status === 'running' ? null : 5, steps: 1, ctx: 1 })
const base = { width: 100, now: Date.now(), colors: new Proxy({}, { get: () => '#fff' }), running: true, model: 'Opus 5.5', effort: 'xhigh', effortN: 9, repo: 'servicasa-platform', branch: 'feat/x', add: 12, del: 3, untracked: 2,
  five: { pct: 95, tail: '', resetsAt: new Date(Date.now() + 9e6).toISOString() }, week: { pct: NaN, tail: '', resetsAt: null }, ctx: { pct: 40, tail: '800k left' },
  hist: [10, 20, 30], tools: 5, turns: 2, startedAt: 1, ahead: 1, behind: 0, cost: '$1.00', turnStart: 1, edits: 2, activity: 'Edit a/b.ts', last: '✓ 0:34 · 0 edits',
  agents: [agent('running'), agent('failed'), agent('stopped'), agent('done')], agentsRunning: 1, agentsTotal: 4 }
for (const ascii of [true, false]) for (const W of [16, 30, 50, 64, 80, 100, 140]) {
  const surface = { elements: { Box: 'Box', Text: 'Text' }, columns: W, state: undefined, setState() {}, every() {} }
  const out = txt(Card({ ...base, ascii, width: W }, surface))
  if (ascii && /[^\x20-\x7e\n]/.test(out)) console.log('ASCII LEAK W=' + W, JSON.stringify(out.match(/[^\x20-\x7e\n]/g)))
}
console.log('rendered ok; sample:\n' + txt(Card({ ...base, ascii: true }, { elements: { Box: 'Box', Text: 'Text' }, columns: 100, state: undefined, setState() {}, every() {} })))
