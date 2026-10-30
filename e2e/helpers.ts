// Shared test helpers: a `test` that fails on page errors and skips the first-visit intro, small
// app actions, a simulated Bungie account, and the layout checker.

import { test as base, expect, type Page } from '@playwright/test'

export { expect }

/** Every page starts with the intro marked as seen (the intro has its own test) and fails on uncaught errors. */
export const test = base.extend<{ errors: string[]; showIntro: boolean }>({
  showIntro: [false, { option: true }],
  errors: async ({}, provide) => { await provide([]) },
  context: async ({ context, showIntro }, provide) => {
    if (!showIntro) await context.addInitScript(() => { try { localStorage.setItem('ghost-directive:seen-intro', '1') } catch { /* private mode */ } })
    await provide(context)
  },
  page: async ({ page, errors }, provide) => {
    page.on('pageerror', (e) => errors.push(e.message))
    await provide(page)
    expect(errors, 'uncaught page errors').toEqual([])
  },
})

/** Fresh app: storage cleared, on the start screen. */
export async function fresh(page: Page) {
  await page.goto('/')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('ghost-directive:seen-intro', '1') })
  await page.reload()
}

/** Dismisses reward screens that open by themselves ("Later"). */
export async function later(page: Page) {
  for (let k = 0; k < 10 && await page.locator('.modal-foot >> text=Later').count(); k++) {
    await page.click('.modal-foot >> text=Later'); await page.waitForTimeout(80)
  }
}

/** Collapses the nightly test tools so they don't cover anything. */
export async function collapseTools(page: Page) {
  await page.click('[aria-label="Collapse test tools"]', { timeout: 1000 }).catch(() => {})
}

/** Opens the test tools, runs `fn`, collapses them again. */
export async function tools(page: Page, fn: () => Promise<void>) {
  await page.click('[aria-label="Open test tools"]', { timeout: 1000 }).catch(() => {})
  await fn()
  await collapseTools(page)
}

/** Picks "you" in the test tools' Guardian selector. */
export async function toolsForMe(page: Page) {
  const sel = page.locator('.devtools select').first()
  const opts = await sel.locator('option').allTextContents()
  await sel.selectOption({ index: Math.max(0, opts.findIndex((o) => /\(you\)/.test(o))) })
}

/** The example run, with its auto-opened reward screens dismissed. */
export async function exampleRun(page: Page) {
  await fresh(page)
  await page.click('text=Or explore an example run')
  await page.waitForSelector('.guardian')
  await later(page)
  await collapseTools(page)
}

/** The host's saved state. */
export const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('ghost-directive:v2') ?? 'null'))

/** Edits the host's saved state, then reloads. */
export async function editStore(page: Page, fn: string) {
  await page.evaluate((src) => { const s = JSON.parse(localStorage.getItem('ghost-directive:v2')!); new Function('s', src)(s); localStorage.setItem('ghost-directive:v2', JSON.stringify(s)) }, fn)
  await page.reload()
}

/** Creates a lobby, picks an artifact and begins a real run. */
export async function startRun(page: Page, artifact = 'Tablet of Ruin') {
  await page.click('text=Create lobby')
  await page.waitForSelector('.seat')
  await collapseTools(page)
  await page.click(`.seat.is-you .art-pick [role=radio][title^="${artifact}"]`)
  await page.click('button:has-text("Begin run")')
  await page.waitForSelector('.command')
  await later(page)
}

// ---------------------------------------------------------------- simulated Bungie account

/** Real item hashes from the item table, and inventory buckets per slot. */
export const I = { KhvostovGrey: 1619016919, KhvostovLegendary: 4209476803, Pariah: 2209451511, StayAway: 2734369894, Hadrian: 3246523828, Helm: 997252576, Arms: 2899766705, Chest: 648507367, Legs: 2731019523, Cloak: 1364005110, Fatebringer: 2171478765, Funnelweb: 3341893443 }
export const B = { k: 1498876634, e: 2465295065, p: 953998645, helm: 3448274439, arms: 3551918588, chest: 14239492, legs: 20886954, cls: 1585787867, sub: 3284755031, vault: 138197802 }
const DEFS: Record<string, string> = { 900: 'Gunslinger', 11: 'Golden Gun: Marksman', 12: 'Knife Trick', 13: 'Swarm Grenade', 14: 'Gunpowder Gamble', 15: 'Acrobat’s Dodge', 16: 'Solar Grenade' }

export type Held = { id: string; hash: number; bucket: number }
export type Account = {
  vault: Held[]
  chars: Record<string, { classType: number; inv: Held[]; eq: Held[]; lastPlayed: string }>
  /** Character in an activity right now, if any. */
  inActivity: string | null
  /** Bungie refuses equips while in an activity. */
  location: boolean
  sub: { id: string; plugs: number[] }
  calls: string[]
  next: number
}

export const HUNTER = '2305843009'
export const TITAN = '2305843010'

/** A Hunter in an activity with Legendary/Common gear on, a Titan with nothing, two weapons in the Vault. */
export function account(): Account {
  const a: Account = { vault: [], chars: {}, inActivity: HUNTER, location: true, sub: { id: '777', plugs: [11, 12, 13, 14, 15] }, calls: [], next: 1000 }
  a.vault = [item(a, I.Pariah, B.k), item(a, I.StayAway, B.e)]
  a.chars[HUNTER] = { classType: 1, inv: [], lastPlayed: '2026-10-27T10:00:00Z', eq: [item(a, I.Fatebringer, B.k), item(a, I.Funnelweb, B.e), item(a, I.Hadrian, B.p), item(a, I.Helm, B.helm), item(a, I.Arms, B.arms), item(a, I.Chest, B.chest), item(a, I.Legs, B.legs), item(a, I.Cloak, B.cls)] }
  a.chars[TITAN] = { classType: 0, inv: [], eq: [], lastPlayed: '2026-10-01T10:00:00Z' }
  return a
}

/** A new copy of an item, with its own instance id. */
export const item = (a: Account, hash: number, bucket: number): Held => ({ id: String(++a.next), hash, bucket })
export const nameOf = (h: Held) => Object.entries(I).find(([, x]) => x === h.hash)?.[0] ?? String(h.hash)

function profile(a: Account) {
  const now = new Date().toISOString()
  const charData: Record<string, unknown> = {}, inv: Record<string, unknown> = {}, eq: Record<string, unknown> = {}, acts: Record<string, unknown> = {}
  const first = Object.keys(a.chars)[0]
  for (const [id, c] of Object.entries(a.chars)) {
    charData[id] = { classType: c.classType, light: 2000, dateLastPlayed: c.lastPlayed }
    inv[id] = { items: c.inv.map((x) => ({ itemHash: x.hash, itemInstanceId: x.id, bucketHash: x.bucket })) }
    eq[id] = { items: [...c.eq.map((x) => ({ itemHash: x.hash, itemInstanceId: x.id, bucketHash: x.bucket })), ...(id === first ? [{ itemHash: 900, itemInstanceId: a.sub.id, bucketHash: B.sub }] : [])] }
    acts[id] = { currentActivityHash: id === a.inActivity ? 1 : 0 }
  }
  return {
    responseMintedTimestamp: now, secondaryComponentsMintedTimestamp: now,
    profileInventory: { data: { items: a.vault.map((x) => ({ itemHash: x.hash, itemInstanceId: x.id, bucketHash: B.vault })) } },
    characters: { data: charData }, characterInventories: { data: inv }, characterEquipment: { data: eq }, characterActivities: { data: acts },
    itemComponents: { sockets: { data: { [a.sub.id]: { sockets: a.sub.plugs.map((h) => ({ plugHash: h, isEnabled: true })) } } } },
  }
}

function find(a: Account, id: string) {
  let i = a.vault.findIndex((x) => x.id === id); if (i >= 0) return { list: a.vault, i, equipped: false }
  for (const c of Object.values(a.chars)) {
    i = c.inv.findIndex((x) => x.id === id); if (i >= 0) return { list: c.inv, i, equipped: false }
    i = c.eq.findIndex((x) => x.id === id); if (i >= 0) return { list: c.eq, i, equipped: true }
  }
  return null
}

const ok = (Response: unknown) => ({ json: { ErrorCode: 1, Response } })
const fail = (ErrorStatus: string) => ({ json: { ErrorCode: 99, ErrorStatus, Message: ErrorStatus } })

/** Routes the page's Bungie traffic (sign-in, token, profile, moves, equips) to the simulated account. */
export async function stubBungie(page: Page, a: Account, baseURL: string, membershipId = '42') {
  await page.route('https://www.bungie.net/en/OAuth/Authorize**', (route) => { const u = new URL(route.request().url()); route.fulfill({ status: 302, headers: { location: `${baseURL}/auth/callback?code=C&state=${u.searchParams.get('state')}` } }) })
  await page.route('**/api/bungie-token', (route) => route.fulfill({ json: { access_token: 'AT', expires_in: 3600, refresh_token: 'RT', refresh_expires_in: 7776000, membership_id: membershipId } }))
  await page.route('https://www.bungie.net/Platform/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null
    if (path.includes('GetMembershipsForCurrentUser')) return route.fulfill(ok({ destinyMemberships: [{ membershipType: 3, membershipId: '77', crossSaveOverride: 3, displayName: 'Tester', bungieGlobalDisplayName: 'Tester', bungieGlobalDisplayNameCode: 42 }], primaryMembershipId: '77' }))
    const m = path.match(/DestinyInventoryItemDefinition\/(\d+)/)
    if (m) return route.fulfill(ok({ displayProperties: { name: DEFS[m[1]] ?? 'Unknown' } }))
    if (path.includes('DestinyArtifactDefinition')) return route.fulfill(ok({ displayProperties: { name: 'Tablet of Ruin' } }))
    if (body) {
      a.calls.push(path.split('/').slice(-2, -1)[0])
      if (path.includes('TransferItem')) {
        const f = find(a, body.itemId); if (!f || f.equipped) return route.fulfill(fail('DestinyItemNotFound'))
        const [x] = f.list.splice(f.i, 1)
        ;(body.transferToVault ? a.vault : a.chars[body.characterId].inv).push(x)
        return route.fulfill(ok(0))
      }
      if (path.includes('EquipItems')) {
        if (a.location) return route.fulfill(fail('DestinyCannotPerformActionAtThisLocation'))
        const c = a.chars[body.characterId]
        const equipResults = body.itemIds.map((id: string) => {
          const i = c.inv.findIndex((x) => x.id === id); if (i < 0) return { itemInstanceId: id, equipStatus: 1 }
          const [x] = c.inv.splice(i, 1); const j = c.eq.findIndex((y) => y.bucket === x.bucket)
          if (j >= 0) c.inv.push(...c.eq.splice(j, 1)); c.eq.push(x)
          return { itemInstanceId: id, equipStatus: 1 }
        })
        return route.fulfill(ok({ equipResults }))
      }
      if (path.includes('InsertSocketPlugFree')) { a.sub.plugs[body.plug.socketIndex] = body.plug.plugItemHash; return route.fulfill(ok({})) }
    }
    return route.fulfill(ok(profile(a)))
  })
}

/** Signs in through the start screen (the simulated OAuth redirect). */
export async function signIn(page: Page) {
  await page.click('.bungie-start button:has-text("Sign in with Bungie")')
  await page.waitForSelector('.bungie-start.is-linked')
}

// ---------------------------------------------------------------- layout

/**
 * Layout problems on the current screen: sideways page scroll, anything past the right edge, text
 * spilling out of its box, and text overlapping other text in the same layer. Content scrolled out of
 * view, collapsed sections and decorative or test-only layers are ignored.
 */
export function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const W = innerWidth, out: string[] = []
    const vis = (el: Element) => { const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 }
    const name = (el: Element) => { const c = String((el as HTMLElement).className?.toString?.() ?? '').trim().split(/\s+/).slice(0, 2).join('.'); const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40); return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${t ? ` "${t}"` : ''}` }
    const skip = (el: Element) => el.closest('.devtools, .devtools-fab, .channel-badge, .toast, .sr-only, [aria-hidden="true"], .tt-pop, .route-ghost, .xp-art, .synaptic-tip') || el.closest('details:not([open]) > :not(summary)')
    const clipped = (el: Element) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) return true; return false }
    if (document.documentElement.scrollWidth > W + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth}px wide`)
    const all = [...document.querySelectorAll('body *')].filter((el) => !skip(el) && vis(el))
    for (const el of all) { const r = el.getBoundingClientRect(); if (r.right > W + 1 && !clipped(el)) out.push(`past the right edge by ${Math.round(r.right - W)}px: ${name(el)}`) }
    const leaves = all.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && !['SCRIPT', 'STYLE', 'OPTION', 'TEXTAREA'].includes(el.tagName))
    for (const el of leaves) {
      const s = getComputedStyle(el)
      if (el.scrollWidth > el.clientWidth + 2 && s.overflowX === 'visible' && s.textOverflow !== 'ellipsis' && el.clientWidth > 0 && s.display !== 'inline') out.push(`text spills out (${el.scrollWidth}>${el.clientWidth}): ${name(el)}`)
    }
    const layerOf = (el: Element) => { for (let a: Element | null = el; a; a = a.parentElement) { if (a.matches('.modal, .scrim')) return a; const p = getComputedStyle(a).position; if (p === 'fixed' || p === 'sticky') return a } return document.body }
    const clipBox = (el: Element) => { let box = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 }; for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflowX + s.overflowY)) { const r = a.getBoundingClientRect(); box = { left: Math.max(box.left, r.left), top: Math.max(box.top, r.top), right: Math.min(box.right, r.right), bottom: Math.min(box.bottom, r.bottom) } } } return box }
    const top = document.querySelector('.scrim')
    const boxes = leaves.filter((el) => !top || top.contains(el)).map((el) => {
      const range = document.createRange(); range.selectNodeContents(el)
      const c = clipBox(el), fs = parseFloat(getComputedStyle(el).fontSize)
      const rects = [...range.getClientRects()].map((x) => {
        const left = Math.max(x.left, c.left), right = Math.min(x.right, c.right)
        // Glyph boxes run taller than tight line heights: keep the font-size band in the middle.
        const pad = Math.max(0, (x.height - fs) / 2)
        const t = Math.max(x.top + pad, c.top), b = Math.min(x.bottom - pad, c.bottom)
        return { left, right, top: t, bottom: b, width: right - left, height: b - t }
      }).filter((x) => x.width > 1 && x.height > 1)
      return { el, layer: layerOf(el), rects }
    }).filter((b) => b.rects.length)
    const seen = new Set<string>()
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue
      for (const ra of a.rects) for (const rb of b.rects) {
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
        if (w > 3 && h > 3 && w * h > 0.25 * Math.min(ra.width * ra.height, rb.width * rb.height)) { const k = `${name(a.el)} × ${name(b.el)}`; if (!seen.has(k)) { seen.add(k); out.push(`overlap: ${k}`) } }
      }
    }
    return out
  })
}

export const SIZES: [number, number][] = [[360, 740], [390, 844], [768, 1024], [1024, 768], [1440, 900], [1920, 1080], [3440, 1440]]

/** Layout problems at every size, as "width: problem" lines. `before` runs after each resize (e.g. scroll into place). */
export async function sweep(page: Page, before?: () => Promise<unknown>, sizes = SIZES) {
  const found: string[] = []
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(350)
    if (before) await before()
    for (const p of await layoutProblems(page)) found.push(`${w}px: ${p}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  return found
}
