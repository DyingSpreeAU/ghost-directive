// Bungie sign-in and read-only profile access (Mode B, Level 3 Integration).
// Tokens live only in this browser (localStorage). The client secret lives in the
// Netlify Function at /api/bungie-token. Nothing here equips or moves items.

import { ALL_SLOTS, type ClassType, type DamageElement, type Rarity, type Slot, type VaultEntry } from './data'
import type { Player } from './model'
import { inClaudeViewer } from './net'

const API_KEY = import.meta.env.VITE_BUNGIE_API_KEY as string | undefined
const CLIENT_ID = import.meta.env.VITE_BUNGIE_CLIENT_ID as string | undefined
const ROOT = 'https://www.bungie.net/Platform'
const TOKENS_KEY = 'ghost-directive:bungie-tokens'
const STATE_KEY = 'ghost-directive:bungie-oauth-state'

/** Sign-in needs the Netlify build with Bungie env vars; the claude.ai version can't reach Bungie. */
export const bungieConfigured = !!API_KEY && !!CLIENT_ID && !inClaudeViewer()

type Tokens = { access: string; accessExp: number; refresh?: string; refreshExp?: number; membershipId: string }

function loadTokens(): Tokens | null {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? 'null') } catch { return null }
}
function saveTokens(t: Tokens | null) {
  try { if (t) localStorage.setItem(TOKENS_KEY, JSON.stringify(t)); else localStorage.removeItem(TOKENS_KEY) } catch { /* ignore */ }
  listeners.forEach((f) => f())
}

const listeners = new Set<() => void>()
/** Re-render hook for sign-in state changes. */
export function onAuthChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f) } }

export function isSignedIn() {
  const t = loadTokens()
  return !!t && (t.accessExp > Date.now() || (!!t.refresh && (t.refreshExp ?? 0) > Date.now()))
}

export function signOut() { saveTokens(null) }

/** Sends the browser to Bungie's sign-in page. It comes back to /auth/callback. */
export function startSignIn() {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  try { sessionStorage.setItem(STATE_KEY, state) } catch { /* ignore */ }
  location.assign(`https://www.bungie.net/en/OAuth/Authorize?client_id=${encodeURIComponent(CLIENT_ID!)}&response_type=code&state=${state}`)
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; refresh_expires_in?: number; membership_id: string; error?: string }

async function tokenCall(body: object): Promise<Tokens> {
  const res = await fetch('/api/bungie-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || !data.access_token) throw new Error(data.error || `Sign-in failed (HTTP ${res.status}).`)
  const now = Date.now()
  return {
    access: data.access_token,
    accessExp: now + (data.expires_in ?? 3600) * 1000,
    refresh: data.refresh_token,
    refreshExp: data.refresh_expires_in ? now + data.refresh_expires_in * 1000 : undefined,
    membershipId: data.membership_id,
  }
}

type SignInResult = { ok: true } | { ok: false; error: string }
let signInResult: SignInResult | null = null
/** The outcome of returning from Bungie's sign-in page; returns it once, then null. */
export function takeSignInResult() { const r = signInResult; signInResult = null; return r }

/** Call before the app renders: finishes sign-in if this page load is Bungie's redirect back. */
export async function completeSignInFromUrl() {
  if (location.pathname !== '/auth/callback') return
  const q = new URLSearchParams(location.search)
  history.replaceState(null, '', '/')
  let expected: string | null = null
  try { expected = sessionStorage.getItem(STATE_KEY); sessionStorage.removeItem(STATE_KEY) } catch { /* ignore */ }
  if (q.get('error')) { signInResult = { ok: false, error: q.get('error_description') || 'Bungie sign-in was cancelled.' }; return }
  const code = q.get('code')
  if (!code || !expected || q.get('state') !== expected) {
    signInResult = { ok: false, error: 'Sign-in could not be verified. Please try again from the same tab.' }
    return
  }
  try {
    saveTokens(await tokenCall({ grant_type: 'authorization_code', code }))
    signInResult = { ok: true }
  } catch (e) {
    signInResult = { ok: false, error: (e as Error).message }
  }
}

let refreshing: Promise<string | null> | null = null
async function accessToken(): Promise<string | null> {
  const t = loadTokens()
  if (!t) return null
  if (t.accessExp - 60_000 > Date.now()) return t.access
  if (!t.refresh || (t.refreshExp ?? 0) < Date.now()) { saveTokens(null); return null }
  refreshing ??= tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh })
    .then((n) => { saveTokens(n); return n.access })
    .catch(() => { saveTokens(null); return null })
    .finally(() => { refreshing = null })
  return refreshing
}

export class BungieError extends Error {}

async function api<T>(path: string): Promise<T> {
  const token = await accessToken()
  if (!token) throw new BungieError('Your Bungie sign-in has expired. Sign in again.')
  const res = await fetch(ROOT + path, { headers: { 'X-API-Key': API_KEY!, Authorization: `Bearer ${token}` } })
  const data = await res.json().catch(() => null) as { ErrorCode?: number; Message?: string; ErrorStatus?: string; Response?: T } | null
  if (res.status === 401) { saveTokens(null); throw new BungieError('Your Bungie sign-in has expired. Sign in again.') }
  if (!data || data.ErrorCode !== 1) {
    if (data?.ErrorStatus === 'SystemDisabled') throw new BungieError('Bungie’s API is down for maintenance. Try again later.')
    throw new BungieError(data?.Message || `Bungie returned HTTP ${res.status}.`)
  }
  return data.Response as T
}

// ------------------------------------------------------------------ item table

type ItemRow = [name: string, slot: number, tier: number, cls: number, damage: number]
let table: Promise<Record<string, ItemRow>> | null = null
/** Compact weapon/armor table generated from the manifest (tools/fetch_sources.py). */
function itemTable() {
  table ??= fetch('/bungie-items.json').then((r) => {
    if (!r.ok) throw new BungieError('Could not load the item list.')
    return r.json()
  }).then((d: { items: Record<string, ItemRow> }) => d.items)
  return table
}

const TIERS: Rarity[] = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Exotic']
const DAMAGE: Record<number, DamageElement | undefined> = { 2: 'Arc', 3: 'Solar', 4: 'Void', 6: 'Stasis', 7: 'Strand' }
const CLASS_TYPE: Record<ClassType, number> = { Titan: 0, Hunter: 1, Warlock: 2 }
const VAULT_BUCKET = 138197802

// ------------------------------------------------------------------ profile snapshot

type Membership = { membershipType: number; membershipId: string; crossSaveOverride: number; displayName: string; bungieGlobalDisplayName?: string; bungieGlobalDisplayNameCode?: number }
type ItemComponent = { itemHash: number; itemInstanceId?: string; bucketHash: number }
type ProfileResponse = {
  profileInventory?: { data?: { items: ItemComponent[] } }
  characters?: { data?: Record<string, { classType: number; light: number; dateLastPlayed: string }> }
  characterInventories?: { data?: Record<string, { items: ItemComponent[] }> }
  characterEquipment?: { data?: Record<string, { items: ItemComponent[] }> }
}

export type BungieSnapshot = {
  name: string
  character: string
  /** Legendary weapons and armor (for this class) in the Vault, for reward choices. */
  vault: VaultEntry[]
  vaultItems: number
  /** Names of every weapon and armor piece the account holds, anywhere. */
  owned: Set<string>
  /** What the synced character has equipped. */
  equipped: { slot: Slot; name: string; rarity: Rarity; instanceId?: string }[]
  /** Every weapon and armor instance on the account (Vault, characters, Postmaster), for drop detection. */
  instances: { instanceId: string; name: string; slot: Slot; rarity: Rarity }[]
}

/** The Destiny membership to read (the cross-save primary where there is one) and its Bungie name. */
async function membership() {
  const m = await api<{ destinyMemberships: Membership[]; primaryMembershipId?: string }>('/User/GetMembershipsForCurrentUser/')
  const ms = m.destinyMemberships ?? []
  const mem = ms.find((x) => x.membershipId === m.primaryMembershipId)
    ?? ms.find((x) => x.crossSaveOverride === x.membershipType)
    ?? ms[0]
  if (!mem) throw new BungieError('This Bungie account has no Destiny 2 profile.')
  const name = mem.bungieGlobalDisplayName
    ? `${mem.bungieGlobalDisplayName}#${String(mem.bungieGlobalDisplayNameCode ?? '').padStart(4, '0')}`
    : mem.displayName
  return { mem, name }
}

/** The signed-in player's Bungie name, for showing who is signed in. */
export async function accountName(): Promise<string> {
  return (await membership()).name
}

/** Reads the signed-in player's profile. Picks their most recently played character of this class. */
export async function fetchSnapshot(cls: ClassType): Promise<BungieSnapshot> {
  const [{ mem, name }, items] = await Promise.all([membership(), itemTable()])

  const p = await api<ProfileResponse>(`/Destiny2/${mem.membershipType}/Profile/${mem.membershipId}/?components=102,200,201,205`)
  const chars = Object.entries(p.characters?.data ?? {})
    .filter(([, c]) => c.classType === CLASS_TYPE[cls])
    .sort((a, b) => b[1].dateLastPlayed.localeCompare(a[1].dateLastPlayed))
  if (p.profileInventory?.data === undefined) throw new BungieError('Bungie did not return your Vault. Check your privacy settings at bungie.net (show my non-equipped inventory).')
  const [charId, char] = chars[0] ?? []

  const owned = new Set<string>()
  const note = (list: ItemComponent[] | undefined) => list?.forEach((i) => { const r = items[i.itemHash]; if (r) owned.add(r[0]) })
  const vaultItems = (p.profileInventory.data.items ?? []).filter((i) => i.bucketHash === VAULT_BUCKET)
  note(vaultItems)
  Object.values(p.characterInventories?.data ?? {}).forEach((c) => note(c.items))
  Object.values(p.characterEquipment?.data ?? {}).forEach((c) => note(c.items))

  const vault: VaultEntry[] = []
  const seen = new Set<string>()
  for (const i of vaultItems) {
    const r = items[i.itemHash]
    if (!r || r[2] !== 3) continue // Legendary only
    const slot = ALL_SLOTS[r[1]]
    const isArmor = r[1] >= 3
    if (isArmor && r[3] !== 3 && r[3] !== CLASS_TYPE[cls]) continue
    const key = `${r[0]}|${slot}`
    if (seen.has(key)) continue
    seen.add(key)
    vault.push({ name: r[0], slot, rarity: 'Legendary', element: DAMAGE[r[4]], archetype: isArmor ? 'Armor' : undefined })
  }

  const equipped = (charId ? p.characterEquipment?.data?.[charId]?.items ?? [] : [])
    .map((i) => ({ i, r: items[i.itemHash] }))
    .filter((x): x is { i: ItemComponent; r: ItemRow } => !!x.r)
    .map(({ i, r }) => ({ slot: ALL_SLOTS[r[1]], name: r[0], rarity: TIERS[r[2]], instanceId: i.itemInstanceId }))

  const instances: BungieSnapshot['instances'] = []
  const collect = (list: ItemComponent[] | undefined) => list?.forEach((i) => {
    const r = items[i.itemHash]
    if (r && i.itemInstanceId) instances.push({ instanceId: i.itemInstanceId, name: r[0], slot: ALL_SLOTS[r[1]], rarity: TIERS[r[2]] })
  })
  collect(p.profileInventory.data.items)
  Object.values(p.characterInventories?.data ?? {}).forEach((c) => collect(c.items))
  Object.values(p.characterEquipment?.data ?? {}).forEach((c) => collect(c.items))

  return {
    name,
    character: char ? `${cls}, ${char.light} Power` : `No ${cls} on this account`,
    vault, vaultItems: vaultItems.length, owned, equipped, instances,
  }
}

/** Compares the run's tracked items with what the account actually holds. */
export function reconcile(snap: BungieSnapshot, p: Player) {
  const tracked = new Set(p.inventory.map((i) => i.name))
  return {
    missing: p.inventory.filter((i) => !snap.owned.has(i.name)).map((i) => i.name),
    untracked: snap.equipped.filter((e) => !tracked.has(e.name)).map(({ slot, name }) => ({ slot, name })),
  }
}

// ------------------------------------------------------------------ drop detection

type Baseline = { ids: string[]; starting: string[] }
const baselineKey = (runId: string, playerId: string) => `ghost-directive:drop-baseline:${runId}:${playerId}`

/**
 * Works out drops by comparing the account with what it held when this run started on this device.
 * The first sync of a run records that baseline (and the equipped gear as starting gear). Each sync
 * then reports every instance that is new since the baseline and not already known to the run, so
 * a sync lost in transit is simply re-sent next time. Moving an item between Vault and character
 * keeps its instance id, so transfers don't count; pulling a fresh copy from Collections does.
 */
export function detectDrops(runId: string, p: Player, snap: BungieSnapshot) {
  const key = baselineKey(runId, p.id)
  let base: Baseline | null = null
  try { base = JSON.parse(localStorage.getItem(key) ?? 'null') } catch { /* fresh baseline */ }
  if (!base) {
    const starting = p.inventory.length === 0 ? snap.equipped.map((e) => e.instanceId).filter((x): x is string => !!x) : []
    base = { ids: snap.instances.map((i) => i.instanceId).filter((id) => !starting.includes(id)), starting }
    try { localStorage.setItem(key, JSON.stringify(base)) } catch { /* detection still works this session */ }
  }
  const baseline = new Set(base.ids)
  const known = new Set([...p.inventory.map((i) => i.instanceId), ...(p.dismissed ?? [])])
  const seen = new Set<string>()
  return snap.instances
    .filter((i) => !baseline.has(i.instanceId) && !known.has(i.instanceId) && !seen.has(i.instanceId) && (seen.add(i.instanceId), true))
    .map((i) => ({ ...i, starting: base!.starting.includes(i.instanceId) }))
}
