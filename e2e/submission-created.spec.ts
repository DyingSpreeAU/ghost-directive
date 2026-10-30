// The Netlify function that turns bug reports into GitHub issues (no browser needed).
import { test, expect } from '@playwright/test'
// @ts-expect-error: plain JS module
import handler, { issueFor } from '../netlify/functions/submission-created.mjs'

const sub = (data: Record<string, string>, form = 'bug-report') => ({ id: 'abc123', form_name: form, created_at: '2026-10-29T07:14:40Z', data })
const req = (payload: unknown) => new Request('https://x/.netlify/functions/submission-created', { method: 'POST', body: JSON.stringify({ payload }) })

test.describe('submission-created', () => {
  const realFetch = globalThis.fetch
  let calls: { labels?: string[]; title: string }[] = []
  let refuseLabels = false
  test.beforeEach(() => {
    calls = []; refuseLabels = false
    process.env.GITHUB_TOKEN = 'test-token'
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)); calls.push({ labels: b.labels, title: b.title })
      if (refuseLabels && b.labels) return new Response('{}', { status: 422 })
      return new Response(JSON.stringify({ html_url: 'https://github.com/x/y/issues/1' }), { status: 201 })
    }) as typeof fetch
  })
  test.afterEach(() => { globalThis.fetch = realFetch; delete process.env.GITHUB_TOKEN })

  test('builds a quiet, readable issue', () => {
    const i = issueFor(sub({ what: 'Trade up vanished @someone', expected: 'It stays | there', channel: 'nightly', data: 'x'.repeat(50000) }))
    expect(i.title).toBe('Bug report: Trade up vanished @​someone')
    expect(i.body).not.toMatch(/@someone/)
    expect(i.body).toContain('…(trimmed)')
    expect(i.labels).toEqual(['bug-report', 'nightly'])
  })

  test('files an issue, retries without labels, ignores other forms and a missing token', async () => {
    expect((await handler(req(sub({ what: 'x', channel: 'production' })))).status).toBe(200)
    expect(calls.at(-1)?.labels).toEqual(['bug-report', 'production'])
    refuseLabels = true; calls = []
    expect((await handler(req(sub({ what: 'x' }))))).toBeTruthy()
    expect(calls.map((c) => c.labels ?? 'none')).toEqual([['bug-report'], 'none'])
    calls = []
    expect((await handler(req(sub({ what: 'x' }, 'other')))).status).toBe(200)
    expect(calls).toHaveLength(0)
    delete process.env.GITHUB_TOKEN
    expect((await handler(req(sub({ what: 'x' }))) ).status).toBe(200)
    expect(calls).toHaveLength(0)
  })
})
