// Turns each bug report (Netlify Forms, form "bug-report") into a GitHub issue on the repo, so
// reports can be read and tracked there. Netlify runs this by itself after every verified form
// submission (the file name is the event); spam-flagged submissions don't trigger it.
//
// Env: GITHUB_TOKEN (required: a fine-grained token with Issues read and write on the repo only),
//      GITHUB_REPO (optional, "owner/name"; defaults to DyingSpreeAU/ghost-directive).

const MAX_BODY = 60000
const MAX_DATA = 40000

const env = (k) => (typeof Netlify !== 'undefined' ? Netlify.env.get(k) : undefined) ?? process.env[k]

/** Player text goes in as-is, except "@" can't notify anyone on GitHub. */
const quiet = (s) => String(s ?? '').replace(/@/g, '@​')
const quote = (s) => quiet(s).trim().split('\n').map((l) => `> ${l}`).join('\n') || '> (empty)'
const cell = (s) => quiet(s).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '–'

export function issueFor(sub) {
  const d = sub.data ?? {}
  const what = String(d.what ?? '').trim()
  const title = `Bug report: ${quiet(what.split('\n')[0].slice(0, 80)) || '(no description)'}`
  const rows = [
    ['Page', d.page], ['Role', d.role], ['Channel', d.channel], ['Version', d.version], ['Bungie', d.bungie],
    ['Contact', d.contact], ['Browser', d.browser], ['Screen', d.screen], ['Sent', d.at || sub.created_at],
  ]
  let data = String(d.data ?? '')
  if (data.length > MAX_DATA) data = data.slice(0, MAX_DATA) + '…(trimmed)'
  let body = [
    '### What happened', quote(what), '',
    '### What they expected', quote(d.expected), '',
    '| | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`), '',
    data ? `<details><summary>Run data (${data.length.toLocaleString('en')} characters)</summary>\n\n\`\`\`json\n${data.replace(/```/g, '`​``')}\n\`\`\`\n</details>` : '_No run data attached._',
    '', `<sub>Netlify Forms submission ${cell(sub.id)}</sub>`,
  ].join('\n')
  if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY) + '\n…(trimmed)'
  const labels = ['bug-report', ...(d.channel ? [String(d.channel).slice(0, 40)] : [])]
  return { title, body, labels }
}

export default async (req) => {
  let sub
  try { sub = JSON.parse(await req.text()).payload } catch { return new Response('Bad payload', { status: 400 }) }
  if (!sub || sub.form_name !== 'bug-report') return new Response('Not a bug report', { status: 200 })
  const token = env('GITHUB_TOKEN')
  if (!token) { console.error('GITHUB_TOKEN is not set: bug report not sent to GitHub.'); return new Response('Not configured', { status: 200 }) }
  const repo = env('GITHUB_REPO') || 'DyingSpreeAU/ghost-directive'
  const issue = issueFor(sub)
  const post = (body) => fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'ghost-directive-bug-reports', 'x-github-api-version': '2022-11-28' },
    body: JSON.stringify(body),
  })
  let res = await post(issue)
  // Labels the token can't create: file the issue without them rather than lose it.
  if (res.status === 422 || res.status === 403) res = await post({ title: issue.title, body: issue.body })
  if (!res.ok) { console.error('GitHub issue not created:', res.status, (await res.text()).slice(0, 300)); return new Response('GitHub error', { status: 502 }) }
  const made = await res.json()
  console.log('Bug report filed as', made.html_url)
  return new Response('ok', { status: 200 })
}
