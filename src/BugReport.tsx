// "Report a bug": a short form sent to Netlify Forms (form "bug-report", declared in index.html so
// Netlify registers it). Reports show in the Netlify dashboard under Forms. Where Netlify isn't
// serving the page (local preview, the claude.ai build), the report is copied to the clipboard instead.

import { useState } from 'react'
import { CHANNEL, VERSION } from './channel'
import { linkStatus } from './BungiePanel'
import { Modal } from './ui'
import type { Lobby, Run } from './model'

/** Netlify caps a form submission; the run data is trimmed to stay well inside it. */
const MAX_DATA = 400_000

export function BugReport({ run, lobby, role }: { run?: Run | null; lobby?: Lobby | null; role?: string }) {
  const [open, setOpen] = useState(false)
  const [what, setWhat] = useState('')
  const [expected, setExpected] = useState('')
  const [contact, setContact] = useState('')
  const [withData, setWithData] = useState(true)
  const [state, setState] = useState<{ busy?: boolean; done?: 'sent' | 'copied'; error?: string }>({})

  const close = () => { setOpen(false); setState({}) }
  const report = () => {
    const data = withData ? JSON.stringify(run ?? lobby ?? null) : ''
    return {
      'form-name': 'bug-report',
      what: what.trim(),
      expected: expected.trim(),
      contact: contact.trim(),
      page: run ? `run (${run.status})` : lobby ? 'lobby' : 'start screen',
      role: role ?? '',
      channel: CHANNEL || 'production',
      version: VERSION,
      bungie: linkStatus(),
      browser: navigator.userAgent,
      screen: `${innerWidth}x${innerHeight}`,
      at: new Date().toISOString(),
      data: data.length > MAX_DATA ? data.slice(0, MAX_DATA) + '…(trimmed)' : data,
    }
  }
  const send = async () => {
    const r = report()
    setState({ busy: true })
    try {
      const res = await fetch('/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(r).toString() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setState({ done: 'sent' })
      setWhat(''); setExpected('')
    } catch {
      // No Netlify here: hand the report over by clipboard instead.
      const text = Object.entries(r).filter(([k]) => k !== 'form-name').map(([k, v]) => `${k}: ${v}`).join('\n')
      navigator.clipboard?.writeText(text).then(() => setState({ done: 'copied' }), () => setState({ error: 'Couldn’t send the report or copy it. Please try again from the live site.' }))
    }
  }

  return (
    <>
      <button className="link bug-link" onClick={() => setOpen(true)}>Report a bug</button>
      {open && (
        <Modal kicker="Ghost Directive" title="Report a bug" onClose={close}
          footer={state.done
            ? <button className="btn btn-light" onClick={close}>Done</button>
            : <>
              <button className="btn btn-ghost" onClick={close}>Cancel</button>
              <button className="btn btn-light" disabled={!what.trim() || state.busy} onClick={send}>{state.busy ? 'Sending…' : 'Send report'}</button>
            </>}
        >
          {state.done === 'sent' ? (
            <p className="tone-ok">&#10003; Thanks. Your report was sent.</p>
          ) : state.done === 'copied' ? (
            <p>This page can&rsquo;t send reports, so the report was <strong>copied to your clipboard</strong>. Paste it to the developer.</p>
          ) : (
            <div className="stack bug-form">
              <label className="field"><span>What went wrong?</span>
                <textarea rows={4} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What you did, and what happened." autoFocus />
              </label>
              <label className="field"><span>What did you expect? <span className="muted">(optional)</span></span>
                <textarea rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} />
              </label>
              <label className="field"><span>How to reach you <span className="muted">(optional: Discord, Bungie name or email)</span></span>
                <input value={contact} onChange={(e) => setContact(e.target.value)} />
              </label>
              {(run || lobby) && (
                <label className="switch"><input type="checkbox" checked={withData} onChange={(e) => setWithData(e.target.checked)} /> Include this {run ? 'run' : 'lobby'}&rsquo;s data (Guardian names, gear, unlocks, log) so the problem can be reproduced</label>
              )}
              <p className="small muted">Your browser, screen size, app version, Bungie sign-in status and the page you&rsquo;re on are included.</p>
              {state.error && <p className="small tone-danger">{state.error}</p>}
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
