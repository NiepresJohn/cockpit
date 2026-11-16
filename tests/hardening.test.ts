import { expect, test } from 'claude-code/testing'

import { dirHint, doing, restore, scrub } from '../hooks/lib'

test('scrub masks JSON bodies, quoted values with spaces and longer flag names', () => {
  expect(scrub(`curl -d '{"password":"hunter2"}'`)).not.toContain('hunter2')
  expect(scrub('MY_KEY="a b c" next')).not.toContain('b c')
  expect(scrub('tool --password "my pass word" go')).not.toContain('pass word')
  expect(scrub('x --client-secret s3cr3tvalue')).not.toContain('s3cr3tvalue')
  expect(scrub('x --access-token tok123456')).not.toContain('tok123456')
  expect(scrub('DB_PASS=pw12345 run')).not.toContain('pw12345')
})

test('scrub masks tool-specific password forms and more token prefixes', () => {
  expect(scrub('docker login -u me -p dockerpw')).not.toContain('dockerpw')
  expect(scrub('redis-cli -a redispw ping')).not.toContain('redispw')
  expect(scrub('aws configure set aws_secret_access_key wJalrXUtnFEMIK7MDENG')).not.toContain('wJalr')
  expect(scrub('key ASIAABCDEFGHIJKLMNOP')).not.toContain('ASIAABCDEFGHIJKLMNOP')
  expect(scrub('glpat-abcdefghijklmnop')).toBe('•••')
})

test('scrub masks url userinfo with and without a password, and ampersand-split curl users', () => {
  expect(scrub('git remote add o https://abcdef0123456789@github.com/x')).not.toContain('abcdef0123456789')
  expect(scrub('curl "https://h/?a=1&b=2" -u user:topsecret')).not.toContain('topsecret')
  expect(scrub('curl --cookie "sid=abc123" https://h')).not.toContain('abc123')
  expect(scrub('https://h/f?X-Amz-Signature=deadbeef&x=1')).not.toContain('deadbeef')
})

test('scrub strips zero-width and bidi characters so they cannot split a keyword', () => {
  expect(scrub('pass\u200bword=hunter2')).not.toContain('hunter2')
  expect(scrub('a\u202eb')).toBe('ab')
})

test('doing survives a huge command quickly', () => {
  const t = Date.now()
  const out = doing('Bash', { input: { command: 'cd a;'.repeat(200000) + 'ls' } })
  expect(out.length).toBeLessThan(5000)
  expect(Date.now() - t).toBeLessThan(500)
})

test('dirHint handles drive roots, Git Bash paths, shell expansions and terminators', () => {
  expect(dirHint({ input: { file_path: 'C:\\x.txt' } })).toBe('C:\\')
  expect(dirHint({ input: { command: 'cd /c/Users/me/app && ls' } })).toBe('C:\\Users\\me\\app')
  expect(dirHint({ input: { command: 'cd /tmp/$X && ls' } })).toBe('')
  expect(dirHint({ input: { command: 'cd ~ && ls' } })).toBe('')
  expect(dirHint({ input: { command: 'cd /dev/app | cat' } })).toBe('')
  expect(dirHint({ input: { command: 'cd /dev/app' } })).toBe('/dev/app')
})

test('restore rejects wrong-typed fields and malformed agents instead of crashing the card', () => {
  const s = restore({
    cost: '12', ctxPct: 'x', model: 5, running: 'yes', legacy: 1,
    agents: [{ id: 'a', status: 'done' }, { status: 'done' }, null, { id: 'b', status: 'weird' }],
    limits: [null, { kind: 'five_hour', pct: 'x' }, { kind: 'seven_day', pct: 40 }],
    where: { add: 'many', repo: 'r' },
  })
  expect(s.cost).toBe(null)
  expect(s.ctxPct).toBe(null)
  expect(s.model).toBe('')
  expect(s.running).toBe(false)
  expect('legacy' in s).toBe(false)
  expect(s.agents.map(a => a.id)).toEqual(['a'])
  expect(s.limits).toEqual([{ kind: 'seven_day', pct: 40, resetsAt: null }])
  expect(s.where).toMatchObject({ repo: 'r', add: 0 })
})
