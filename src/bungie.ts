// Bungie sign-in and profile access (Mode B, Level 3 Integration).
// Tokens live only in this browser (localStorage). The client secret lives in the
// Netlify Function at /api/bungie-token. Only restoreGuardian moves or equips items,
// and only when the player asks for it.

import { ALL_SLOTS, ARTIFACTS, PRISMATIC_BASE_GRENADES, subclassAbilities, STARTER_KINDS, type StarterKind, type AbilityKind, type ClassType, type DamageElement, type Element, type Rarity, type Slot, type VaultEntry } from './data'
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

/** The signed-in Bungie.net account id, used to match a player back to their Guardian in a run. */
export function bungieAccountId(): string | null {
  return isSignedIn() ? loadTokens()?.membershipId ?? null : null
}

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

/** A refused item action; `status` is Bungie's ErrorStatus. */
export class BungieActionError extends BungieError {
  status: string
  constructor(message: string, status: string) { super(message); this.status = status }
}

async function api<T>(path: string, body?: object): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken()
    if (!token) throw new BungieError('Your Bungie sign-in has expired. Sign in again.')
    const res = await fetch(ROOT + path, body
      ? { method: 'POST', headers: { 'X-API-Key': API_KEY!, Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { headers: { 'X-API-Key': API_KEY!, Authorization: `Bearer ${token}` } })
    const data = await res.json().catch(() => null) as { ErrorCode?: number; Message?: string; ErrorStatus?: string; ThrottleSeconds?: number; Response?: T } | null
    if (res.status === 401) { saveTokens(null); throw new BungieError('Your Bungie sign-in has expired. Sign in again.') }
    if (data && data.ErrorCode === 1) return data.Response as T
    const status = data?.ErrorStatus ?? ''
    // Item actions are rate limited; Bungie says how long to wait.
    if (/Throttle/.test(status) && attempt < 4) { await wait(Math.max(1, data?.ThrottleSeconds ?? 1) * 1000); continue }
    if (status === 'SystemDisabled') throw new BungieError('Bungie’s API is down for maintenance. Try again later.')
    if (body) throw new BungieActionError(data?.Message || `Bungie returned HTTP ${res.status}.`, status)
    throw new BungieError(data?.Message || `Bungie returned HTTP ${res.status}.`)
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

let exotics: Promise<Record<string, [name: string, classType: number]>> | null = null
/** Exotic armor Collections entries: collectible hash → name and class. */
function exoticTable() {
  exotics ??= fetch('/bungie-exotics.json').then((r) => (r.ok ? r.json() : { collectibles: {} }))
    .then((d: { collectibles: Record<string, [string, number]> }) => d.collectibles, () => ({}))
  return exotics
}

const TIERS: Rarity[] = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Exotic']
const DAMAGE: Record<number, DamageElement | undefined> = { 2: 'Arc', 3: 'Solar', 4: 'Void', 6: 'Stasis', 7: 'Strand' }
const CLASS_TYPE: Record<ClassType, number> = { Titan: 0, Hunter: 1, Warlock: 2 }
const VAULT_BUCKET = 138197802

// ------------------------------------------------------------------ profile snapshot

type Membership = { membershipType: number; membershipId: string; crossSaveOverride: number; displayName: string; bungieGlobalDisplayName?: string; bungieGlobalDisplayNameCode?: number }
type ItemComponent = { itemHash: number; itemInstanceId?: string; bucketHash: number }
type ProfileResponse = {
  /** When Bungie's servers produced this response, and the inventory parts of it (ISO times). */
  responseMintedTimestamp?: string
  secondaryComponentsMintedTimestamp?: string
  profileInventory?: { data?: { items: ItemComponent[] } }
  characters?: { data?: Record<string, { classType: number; light: number; dateLastPlayed: string; emblemPath?: string; emblemBackgroundPath?: string }> }
  characterActivities?: { data?: Record<string, { currentActivityHash?: number }> }
  characterProgressions?: { data?: Record<string, { seasonalArtifact?: { artifactHash?: number; tiers?: { items?: { itemHash: number; isActive?: boolean }[] }[] } }> }
  characterInventories?: { data?: Record<string, { items: ItemComponent[] }> }
  characterEquipment?: { data?: Record<string, { items: ItemComponent[] }> }
  /** Collections (component 800): state bit 1 means not acquired. */
  profileCollectibles?: { data?: { collectibles?: Record<string, { state: number }> } }
  characterCollectibles?: { data?: Record<string, { collectibles?: Record<string, { state: number }> }> }
  itemComponents?: {
    sockets?: { data?: Record<string, { sockets: { plugHash?: number; isEnabled?: boolean }[] }> }
    /** Instance stats (component 304), e.g. a weapon's rolled Range or Handling. */
    stats?: { data?: Record<string, { stats: Record<string, { statHash: number; value: number }> }> }
    /** Instance details (component 300): power level, element. */
    instances?: { data?: Record<string, { primaryStat?: { value: number }; damageType?: number }> }
    /** What each socket can take (component 310), by socket index. */
    reusablePlugs?: { data?: Record<string, { plugs: Record<string, { plugItemHash: number; canInsert?: boolean }[]> }> }
  }
}

/**
 * When Bungie produced the inventory data: the secondary components' time, else the response's.
 * Bungie sends 0001-01-01 for the secondary time when it doesn't apply, so that one is ignored.
 */
function mintedAt(p: ProfileResponse): number | null {
  const valid = (t?: string) => { const ms = t ? Date.parse(t) : NaN; return ms > Date.UTC(2017, 0) ? ms : null }
  return valid(p.secondaryComponentsMintedTimestamp) ?? valid(p.responseMintedTimestamp)
}

export type ClassItemRoll = { instanceId: string; perks: { name: string; desc?: string }[] }

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
  /** Every weapon and armor piece on the synced character, equipped or carried. */
  carried: { slot: Slot; name: string; rarity: Rarity; instanceId?: string; equipped: boolean }[]
  /** Every weapon and armor instance on the account (Vault, characters, Postmaster), for drop detection. */
  instances: { instanceId: string; name: string; slot: Slot; rarity: Rarity }[]
  /** The synced character's equipped subclass and what's slotted in it, or null if unreadable. */
  subclass: EquippedSubclass | null
  /** The character's equipped artifact and its active perks, or null if unreadable. */
  artifact: EquippedArtifact | null
  /** When Bungie generated the inventory data. */
  mintedAt: number | null
  /** The synced character's gear and subclass setup, for putting it back later. */
  restore: RestorePoint | null
  /** The character's equipped emblem: its square icon and the wide nameplate banner (bungie.net paths). */
  emblem: { icon: string; background: string } | null
  /** Copies of this class's Exotic class item on the account, with their rolled perks. */
  classItems: ClassItemRoll[]
  /** This class's Exotic armor unlocked in Collections, and which of those are on the account; null if Bungie didn't say. */
  exotics: { unlocked: string[]; held: string[] } | null
}

/** A character's equipped gear and subclass sockets, recorded so the run's setup can be re-equipped. */
export type RestorePoint = {
  characterId: string
  /** Instance ids of the equipped weapons and armor. */
  equipped: string[]
  subclass?: { itemId: string; plugs: [socketIndex: number, plugHash: number][] }
  /** The equipped artifact item and its perk sockets. */
  artifact?: { itemId: string; plugs: [socketIndex: number, plugHash: number][] }
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
  const [{ mem, name }, items, exoticRows] = await Promise.all([membership(), itemTable(), exoticTable()])

  const p = await api<ProfileResponse>(`/Destiny2/${mem.membershipType}/Profile/${mem.membershipId}/?components=102,200,201,202,204,205,305,800`)
  if (p.profileInventory?.data === undefined) throw new BungieError('Bungie did not return your Vault. Check your privacy settings at bungie.net (show my non-equipped inventory).')
  const picked = pickCharacter(p, cls)
  const [charId, char] = picked ? [picked.id, picked.char] : []

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

  const carried: BungieSnapshot['carried'] = charId ? [
    ...(p.characterEquipment?.data?.[charId]?.items ?? []).map((i) => ({ i, equipped: true })),
    ...(p.characterInventories?.data?.[charId]?.items ?? []).map((i) => ({ i, equipped: false })),
  ].flatMap(({ i, equipped }) => { const r = items[i.itemHash]; return r ? [{ slot: ALL_SLOTS[r[1]], name: r[0], rarity: TIERS[r[2]], instanceId: i.itemInstanceId, equipped }] : [] }) : []

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
    vault, vaultItems: vaultItems.length, owned, equipped, carried, instances,
    subclass: charId ? await readSubclass(p, charId, cls).catch(() => null) : null,
    artifact: charId ? await readArtifact(p, charId).catch(() => null) : null,
    mintedAt: mintedAt(p),
    restore: charId ? restorePoint(p, charId, items) : null,
    emblem: char?.emblemPath && char.emblemBackgroundPath ? { icon: char.emblemPath, background: char.emblemBackgroundPath } : null,
    exotics: collectedExotics(p, exoticRows, cls, owned),
    classItems: await classItemRolls(p, items, cls).catch(() => []),
  }
}

/** Socket category of an Exotic class item's two rolled perks ("Spirit of the …"). */
const EXOTIC_CLASS_PERKS = 2518356196
const EXOTIC_CLASS_ITEM: Record<ClassType, string> = { Titan: 'Stoicism', Hunter: 'Relativism', Warlock: 'Solipsism' }

/** Every copy of this class's Exotic class item on the account, with its two rolled perks. */
async function classItemRolls(p: ProfileResponse, items: Record<string, ItemRow>, cls: ClassType): Promise<ClassItemRoll[]> {
  const name = EXOTIC_CLASS_ITEM[cls]
  const all = [
    ...(p.profileInventory?.data?.items ?? []),
    ...Object.values(p.characterInventories?.data ?? {}).flatMap((c) => c.items),
    ...Object.values(p.characterEquipment?.data ?? {}).flatMap((c) => c.items),
  ].filter((i) => i.itemInstanceId && items[i.itemHash]?.[0] === name)
  const out = await Promise.all(all.slice(0, 20).map(async (i): Promise<ClassItemRoll | null> => {
    const def = await itemDef(i.itemHash)
    const idx = def?.sockets?.socketCategories?.find((c) => c.socketCategoryHash === EXOTIC_CLASS_PERKS)?.socketIndexes ?? []
    const sockets = p.itemComponents?.sockets?.data?.[i.itemInstanceId!]?.sockets ?? []
    const perks = await Promise.all(idx.map(async (k): Promise<ClassItemRoll['perks'][number] | null> => {
      const d = sockets[k]?.plugHash ? await itemDef(sockets[k].plugHash!) : null
      return d?.displayProperties?.name ? { name: d.displayProperties.name.trim(), desc: d.displayProperties.description?.trim() || undefined } : null
    }))
    const got = perks.filter((x): x is ClassItemRoll['perks'][number] => !!x)
    return got.length ? { instanceId: i.itemInstanceId!, perks: got } : null
  }))
  return out.filter((x): x is ClassItemRoll => !!x)
}

/** This class's Exotic armor unlocked in Collections (on the profile or any character), or null without Collections data. */
function collectedExotics(p: ProfileResponse, rows: Record<string, [string, number]>, cls: ClassType, owned: Set<string>) {
  const scopes = [p.profileCollectibles?.data?.collectibles, ...Object.values(p.characterCollectibles?.data ?? {}).map((c) => c.collectibles)]
    .filter((c): c is Record<string, { state: number }> => !!c)
  if (!scopes.length) return null
  const unlocked = new Set<string>()
  for (const [hash, [name, classType]] of Object.entries(rows)) {
    if (classType !== CLASS_TYPE[cls]) continue
    if (scopes.some((c) => c[hash] && (c[hash].state & 1) === 0)) unlocked.add(name)
  }
  return { unlocked: [...unlocked], held: [...unlocked].filter((n) => owned.has(n)) }
}

function restorePoint(p: ProfileResponse, charId: string, items: Record<string, ItemRow>): RestorePoint {
  const eq = p.characterEquipment?.data?.[charId]?.items ?? []
  const withPlugs = (i: ItemComponent | undefined) => {
    if (!i?.itemInstanceId) return undefined
    const sockets = p.itemComponents?.sockets?.data?.[i.itemInstanceId]?.sockets ?? []
    return { itemId: i.itemInstanceId, plugs: sockets.flatMap((s, idx): [number, number][] => (s.plugHash ? [[idx, s.plugHash]] : [])) }
  }
  const sub = eq.find((i) => i.bucketHash === SUBCLASS_BUCKET)
  const sockets = sub?.itemInstanceId ? p.itemComponents?.sockets?.data?.[sub.itemInstanceId]?.sockets ?? [] : []
  return {
    artifact: withPlugs(eq.find((i) => i.bucketHash === ARTIFACT_BUCKET)),
    characterId: charId,
    equipped: eq.filter((i) => items[i.itemHash] && i.itemInstanceId).map((i) => i.itemInstanceId!),
    subclass: sub?.itemInstanceId
      ? { itemId: sub.itemInstanceId, plugs: sockets.flatMap((s, idx): [number, number][] => (s.plugHash ? [[idx, s.plugHash]] : [])) }
      : undefined,
  }
}

/** Compares the run's tracked items with what the account actually holds. */
/**
 * Compares the run with the account: run items not on the account, gear on the character that isn't
 * in the run (with what happened to it, if it left the run earlier), and items the run says were
 * dismantled that still exist.
 */
export function reconcile(snap: BungieSnapshot, p: Player) {
  const ids = new Set(snap.instances.map((i) => i.instanceId))
  const runIds = new Set(p.inventory.map((i) => i.instanceId).filter(Boolean))
  const runNames = new Set(p.inventory.filter((i) => !i.instanceId).map((i) => `${i.slot}|${i.name}`))
  const fates = new Map((p.retired ?? []).filter((r) => r.instanceId).map((r) => [r.instanceId!, r.fate]))
  return {
    missing: p.inventory.filter((i) => (i.instanceId ? !ids.has(i.instanceId) : !snap.owned.has(i.name))).map((i) => i.name),
    untracked: snap.carried
      .filter((c) => !(c.instanceId && runIds.has(c.instanceId)) && !runNames.has(`${c.slot}|${c.name}`))
      .map((c) => ({ slot: c.slot, name: c.name, rarity: c.rarity, instanceId: c.instanceId, equipped: c.equipped, fate: c.instanceId ? fates.get(c.instanceId) : undefined })),
    undismantled: (p.retired ?? []).filter((r) => r.fate === 'dismantled' && r.instanceId && ids.has(r.instanceId)).map((r) => r.name),
  }
}

// ------------------------------------------------------------------ drop detection

/** `at`: when the baseline was last brought up to date (a reopened run does that once). */
type Baseline = { ids: string[]; starting: string[]; at?: number }
const baselineKey = (runId: string, playerId: string) => `ghost-directive:drop-baseline:${runId}:${playerId}`

/**
 * Works out drops by comparing the account with what it held when this run started on this device.
 * The first sync of a run records that baseline (and the equipped gear as starting gear). Each sync
 * then reports every instance that is new since the baseline and not already known to the run, so
 * a sync lost in transit is simply re-sent next time. Moving an item between Vault and character
 * keeps its instance id, so transfers don't count; pulling a fresh copy from Collections does.
 */
export function detectDrops(runId: string, p: Player, snap: BungieSnapshot, rebaseAt?: number) {
  const key = baselineKey(runId, p.id)
  let base: Baseline | null = null
  try { base = JSON.parse(localStorage.getItem(key) ?? 'null') } catch { /* fresh baseline */ }
  const known = new Set([...p.inventory.map((i) => i.instanceId), ...(p.dismissed ?? [])])
  if (!base) {
    const starting = p.inventory.length === 0 ? snap.equipped.map((e) => e.instanceId).filter((x): x is string => !!x) : []
    base = { ids: snap.instances.map((i) => i.instanceId).filter((id) => !starting.includes(id)), starting, at: Date.now() }
    try { localStorage.setItem(key, JSON.stringify(base)) } catch { /* detection still works this session */ }
  } else if (rebaseAt && (base.at ?? 0) < rebaseAt) {
    // The run was reopened: whatever arrived while it was paused came from normal play, not the run.
    const ids = new Set(base.ids)
    for (const i of snap.instances) if (!known.has(i.instanceId)) ids.add(i.instanceId)
    base = { ...base, ids: [...ids], at: Date.now() }
    try { localStorage.setItem(key, JSON.stringify(base)) } catch { /* detection still works this session */ }
  }
  const baseline = new Set(base.ids)
  const seen = new Set<string>()
  return snap.instances
    .filter((i) => !baseline.has(i.instanceId) && !known.has(i.instanceId) && !seen.has(i.instanceId) && (seen.add(i.instanceId), true))
    .map((i) => ({ ...i, starting: base!.starting.includes(i.instanceId) }))
}

// ------------------------------------------------------------------ equipped preview

const CLASS_NAME: Record<number, ClassType> = { 0: 'Titan', 1: 'Hunter', 2: 'Warlock' }

export type EquippedPreview = {
  name: string
  cls: ClassType
  light: number
  /** True when this character is in game right now; otherwise it's the most recently played one. */
  online: boolean
  /** The equipped subclass and what's slotted in it. */
  subclass: EquippedSubclass | null
  artifact: EquippedArtifact | null
  /** The character's equipped emblem (bungie.net paths). */
  emblem: { icon: string; background: string } | null
  items: { slot: Slot; name: string; rarity: Rarity }[]
  /** When Bungie produced the inventory data (it can lag the game by a minute or more). */
  mintedAt: number | null
  fetchedAt: number
}

/** What the active character has equipped right now, for the lobby preview (offline: the seat's class, when given). */
export async function fetchEquipped(prefer?: ClassType): Promise<EquippedPreview> {
  const [{ mem, name }, items] = await Promise.all([membership(), itemTable()])
  const p = await api<ProfileResponse>(`/Destiny2/${mem.membershipType}/Profile/${mem.membershipId}/?components=200,202,204,205,305`)
  const picked = pickFor(p, prefer)
  if (!picked) throw new BungieError('No characters found on this account.')
  const { id, char: c, online } = picked
  const equipped = (p.characterEquipment?.data?.[id]?.items ?? [])
    .map((i) => items[i.itemHash])
    .filter((r): r is ItemRow => !!r)
    .map((r) => ({ slot: ALL_SLOTS[r[1]], name: r[0], rarity: TIERS[r[2]] }))
    .sort((a, b) => ALL_SLOTS.indexOf(a.slot) - ALL_SLOTS.indexOf(b.slot))
  const cls = CLASS_NAME[c.classType] ?? 'Hunter'
  const emblem = c.emblemPath && c.emblemBackgroundPath ? { icon: c.emblemPath, background: c.emblemBackgroundPath } : null
  return { name, cls, light: c.light, online, emblem, items: equipped, subclass: await readSubclass(p, id, cls).catch(() => null), artifact: await readArtifact(p, id).catch(() => null), mintedAt: mintedAt(p), fetchedAt: Date.now() }
}

// ------------------------------------------------------------------ equipped subclass

const SUBCLASS_BUCKET = 3284755031
/** Subclass item names -> element (Prismatic subclasses are "Prismatic Hunter" etc.). */
const SUBCLASS_ELEMENT: Record<string, Element> = {
  Gunslinger: 'Solar', Sunbreaker: 'Solar', Dawnblade: 'Solar',
  Arcstrider: 'Arc', Striker: 'Arc', Stormcaller: 'Arc',
  Nightstalker: 'Void', Sentinel: 'Void', Voidwalker: 'Void',
  Revenant: 'Stasis', Behemoth: 'Stasis', Shadebinder: 'Stasis',
  Threadrunner: 'Strand', Berserker: 'Strand', Broodweaver: 'Strand',
}

/** Names of single item definitions (subclasses, ability plugs), cached for this page. */
type ItemDef = {
  displayProperties?: { name?: string; icon?: string; description?: string }
  itemTypeDisplayName?: string
  flavorText?: string
  screenshot?: string
  defaultDamageType?: number
  inventory?: { tierType?: number }
  /** ammoType: 1 primary, 2 special, 3 heavy. */
  equippingBlock?: { ammoType?: number }
  plug?: { plugCategoryIdentifier?: string }
  sockets?: {
    socketEntries?: { singleInitialItemHash?: number; reusablePlugSetHash?: number }[]
    socketCategories?: { socketCategoryHash: number; socketIndexes: number[] }[]
  }
}
const itemDefs = new Map<number, Promise<ItemDef | null>>()
function itemDef(hash: number) {
  if (!itemDefs.has(hash)) itemDefs.set(hash, api<ItemDef>(`/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash >>> 0}/`).catch(() => null))
  return itemDefs.get(hash)!
}
const defName = (hash: number) => itemDef(hash).then((d) => d?.displayProperties?.name?.trim() || null)

const plugSets = new Map<number, Promise<number[]>>()
function plugSet(hash: number) {
  if (!plugSets.has(hash)) {
    plugSets.set(hash, api<{ reusablePlugItems?: { plugItemHash: number }[] }>(`/Destiny2/Manifest/DestinyPlugSetDefinition/${hash >>> 0}/`)
      .then((d) => (d.reusablePlugItems ?? []).map((x) => x.plugItemHash))
      .catch(() => []))
  }
  return plugSets.get(hash)!
}

/** The character's equipped subclass and the names of everything slotted in it. */
async function readSubclass(p: ProfileResponse, charId: string, cls: ClassType) {
  const sub = p.characterEquipment?.data?.[charId]?.items.find((i) => i.bucketHash === SUBCLASS_BUCKET)
  if (!sub) return null
  const name = await defName(sub.itemHash)
  if (!name) return null
  const element: Element | undefined = name.startsWith('Prismatic') ? 'Prismatic' : SUBCLASS_ELEMENT[name]
  if (!element || (name.startsWith('Prismatic') && !name.endsWith(cls))) return null
  const sockets = sub.itemInstanceId ? p.itemComponents?.sockets?.data?.[sub.itemInstanceId]?.sockets ?? [] : []
  const hashes = [...new Set(sockets.map((s) => s.plugHash).filter((h): h is number => !!h))]
  const plugs = (await Promise.all(hashes.map(defName))).filter((n): n is string => !!n)
  return classifySubclass(cls, name, element, plugs)
}

export type EquippedSubclass = {
  name: string
  element: Element
  /** Ability ids (our data) for everything recognised in the subclass's sockets. */
  abilityIds: string[]
  super?: string
  class?: string
  melee?: string
  grenade?: string
  aspects: string[]
  fragments: string[]
}

const normName = (x: string) => x.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')

/** Sorts a subclass's slotted plugs into Super, melee, grenade, aspects and fragments by name. */
export function classifySubclass(cls: ClassType, name: string, element: Element, plugs: string[]): EquippedSubclass {
  const byName = new Map(subclassAbilities(cls, element).map((a) => [normName(a.name), a]))
  const out: EquippedSubclass = { name, element, abilityIds: [], aspects: [], fragments: [] }
  for (const plug of plugs) {
    const a = byName.get(normName(plug))
    if (!a || out.abilityIds.includes(a.id)) continue
    out.abilityIds.push(a.id)
    const k: AbilityKind = a.kind
    if (k === 'aspect') out.aspects.push(a.name)
    else if (k === 'fragment') out.fragments.push(a.name)
    else out[k] ??= a.name
  }
  return out
}

/**
 * The character to read: the one in game right now (its current activity is set while online,
 * in orbit or an activity), otherwise the most recently played. Optionally limited to a class.
 */
/**
 * The character to read for a seat: the one in game right now, else the most recently played of
 * the seat's class, else the most recently played.
 */
function pickFor(p: ProfileResponse, prefer?: ClassType) {
  const any = pickCharacter(p)
  if (!any || any.online || !prefer) return any
  return pickCharacter(p, prefer) ?? any
}

function pickCharacter(p: ProfileResponse, cls?: ClassType) {
  const acts = p.characterActivities?.data ?? {}
  const list = Object.entries(p.characters?.data ?? {})
    .filter(([, c]) => cls === undefined || c.classType === CLASS_TYPE[cls])
    .map(([id, char]) => ({ id, char, online: (acts[id]?.currentActivityHash ?? 0) !== 0 }))
    .sort((a, b) => Number(b.online) - Number(a.online) || b.char.dateLastPlayed.localeCompare(a.char.dateLastPlayed))
  return list[0] ?? null
}

// ------------------------------------------------------------------ equipped artifact

export type EquippedArtifact = {
  /** Bungie's name for the artifact. */
  name: string
  /** The matching artifact in our data, when the names line up. */
  matched?: string
  /** Names of the perks switched on in game. */
  activePerks: string[]
}

const artifactNames = new Map<number, Promise<string | null>>()
function artifactName(hash: number) {
  if (!artifactNames.has(hash)) {
    artifactNames.set(hash, api<{ displayProperties?: { name?: string } }>(`/Destiny2/Manifest/DestinyArtifactDefinition/${hash >>> 0}/`)
      .then((d) => d.displayProperties?.name?.trim() || null)
      .catch(() => null))
  }
  return artifactNames.get(hash)!
}

const ARTIFACT_BUCKET = 1506418338

/**
 * The character's artifact and the perks slotted in it. Artifacts are now chosen and equipped as an
 * item (artifact bucket) with perks in its sockets; the older seasonal-artifact progression keeps
 * reporting the season's default artifact, so it's only a fallback.
 */
async function readArtifact(p: ProfileResponse, charId: string): Promise<EquippedArtifact | null> {
  const item = p.characterEquipment?.data?.[charId]?.items.find((i) => i.bucketHash === ARTIFACT_BUCKET)
  if (item) {
    const name = await defName(item.itemHash)
    if (name) {
      const sockets = item.itemInstanceId ? p.itemComponents?.sockets?.data?.[item.itemInstanceId]?.sockets ?? [] : []
      const hashes = [...new Set(sockets.map((x) => x.plugHash).filter((h): h is number => !!h))]
      const plugs = (await Promise.all(hashes.map(defName))).filter((n): n is string => !!n)
      return { name, matched: matchArtifact(name), activePerks: plugs.filter((n) => !/^Empty\b/i.test(n)) }
    }
  }
  const art = p.characterProgressions?.data?.[charId]?.seasonalArtifact
  if (!art?.artifactHash) return null
  const name = await artifactName(art.artifactHash)
  if (!name) return null
  const active = (art.tiers ?? []).flatMap((t) => t.items ?? []).filter((i) => i.isActive).map((i) => i.itemHash)
  const activePerks = (await Promise.all([...new Set(active)].map(defName))).filter((n): n is string => !!n)
  return { name, matched: matchArtifact(name), activePerks }
}
const matchArtifact = (name: string) => ARTIFACTS.find((a) => normName(a.name) === normName(name))?.name

// ------------------------------------------------------------------ restore a run's setup

const POSTMASTER_BUCKET = 215593132

export type RestoreReport = {
  character: string
  vaulted: string[]
  pulled: string[]
  /** 'location': Bungie only equips in orbit, a social space, or while offline. */
  equip: 'done' | 'partial' | 'location' | 'skipped'
  /** Tracked items that couldn't be found on the account, or couldn't be moved. */
  problems: string[]
}

type Held = { instanceId: string; itemHash: number; name: string; where: 'vault' | 'postmaster' | string; equipped: boolean; exotic: boolean }

/** Every weapon and armor instance on the account and where it is. */
function holdings(p: ProfileResponse, items: Record<string, ItemRow>): Held[] {
  const out: Held[] = []
  const add = (list: ItemComponent[] | undefined, where: (i: ItemComponent) => Held['where'] | null, equipped: boolean) => list?.forEach((i) => {
    const r = items[i.itemHash]
    const w = where(i)
    if (r && i.itemInstanceId && w) out.push({ instanceId: i.itemInstanceId, itemHash: i.itemHash, name: r[0], where: w, equipped, exotic: r[2] === 4 })
  })
  add(p.profileInventory?.data?.items, (i) => (i.bucketHash === VAULT_BUCKET ? 'vault' : null), false)
  for (const [id, c] of Object.entries(p.characterInventories?.data ?? {})) add(c.items, (i) => (i.bucketHash === POSTMASTER_BUCKET ? 'postmaster' : id), false)
  for (const [id, c] of Object.entries(p.characterEquipment?.data ?? {})) add(c.items, () => id, true)
  return out
}

const noScope = (e: unknown) => e instanceof BungieActionError && /Scope/.test(e.status)
const actionMessage = (e: unknown) => {
  if (!(e instanceof BungieActionError)) return (e as Error).message
  if (/Scope/.test(e.status)) return 'This Bungie app isn’t allowed to move items yet. Enable “Move or equip Destiny gear” for the app on bungie.net, then sign out and back in.'
  if (/NoRoom|Full/.test(e.status)) return 'No room: your Vault or character inventory is full.'
  return e.message
}
/** True when Bungie refused because the character is in an activity. */
const wrongPlace = (e: unknown) => e instanceof BungieActionError && /Location|Activity|InCombat/.test(e.status)

/**
 * Puts a run's setup back on the run's character: sends weapons and armor that aren't part of the
 * run to the Vault, pulls the run's items onto the character, then equips the last recorded
 * setup and subclass. Bungie only allows equipping in orbit, a social space, or while offline;
 * moving items works anywhere.
 */
export async function restoreGuardian(player: Player, point: RestorePoint | undefined, progress: (msg: string) => void): Promise<RestoreReport> {
  const [{ mem }, items] = await Promise.all([membership(), itemTable()])
  const read = () => api<ProfileResponse>(`/Destiny2/${mem.membershipType}/Profile/${mem.membershipId}/?components=102,200,201,204,205,305`)
  let p = await read()
  const chars = p.characters?.data ?? {}
  const charId = point && chars[point.characterId]?.classType === CLASS_TYPE[player.cls] ? point.characterId : pickCharacter(p, player.cls)?.id
  if (!charId) throw new BungieError(`There's no ${player.cls} on this account.`)
  const report: RestoreReport = { character: `${player.cls}, ${chars[charId].light} Power`, vaulted: [], pulled: [], equip: 'skipped', problems: [] }
  const move = (h: Held, toVault: boolean, characterId: string) =>
    api('/Destiny2/Actions/Items/TransferItem/', { itemReferenceHash: h.itemHash, stackSize: 1, transferToVault: toVault, itemId: h.instanceId, characterId, membershipType: mem.membershipType })

  // Which instances are the run's items: by instance id, else the best copy with the same name.
  const held = holdings(p, items)
  const tracked = new Set<string>()
  for (const it of player.inventory) {
    const exact = it.instanceId ? held.find((h) => h.instanceId === it.instanceId) : undefined
    const byName = exact ?? held
      .filter((h) => h.name === it.name && !tracked.has(h.instanceId) && h.where !== 'postmaster')
      .sort((a, b) => Number(b.where === charId) - Number(a.where === charId) || Number(b.where === 'vault') - Number(a.where === 'vault'))[0]
    if (byName) tracked.add(byName.instanceId)
    else report.problems.push(`${it.name}: not found on your account`)
  }

  const vaultExtras = async () => {
    for (const h of holdings(p, items).filter((x) => x.where === charId && !x.equipped && !tracked.has(x.instanceId))) {
      progress(`Sending ${h.name} to the Vault…`)
      try { await move(h, true, charId); report.vaulted.push(h.name) } catch (e) {
        // Without the move/equip permission nothing will work, so stop at the first refusal.
        if (noScope(e)) throw new BungieError(actionMessage(e))
        report.problems.push(`${h.name}: ${actionMessage(e)}`)
      }
    }
  }

  // 1. Clear room on the character.
  await vaultExtras()
  // 2. Bring the run's items over (via the Vault from other characters).
  for (const h of held.filter((x) => tracked.has(x.instanceId) && x.where !== charId)) {
    if (h.where === 'postmaster') { report.problems.push(`${h.name}: in the Postmaster, collect it in game`); continue }
    if (h.equipped) { report.problems.push(`${h.name}: equipped on another character`); continue }
    progress(`Pulling ${h.name} to your ${player.cls}…`)
    try {
      if (h.where !== 'vault') await move(h, true, h.where)
      await move(h, false, charId)
      report.pulled.push(h.name)
    } catch (e) {
      if (noScope(e)) throw new BungieError(actionMessage(e))
      report.problems.push(`${h.name}: ${actionMessage(e)}`)
    }
  }
  // 3. Equip the last recorded setup (or the run's equipped items), then the subclass sockets.
  const wanted = (point?.characterId === charId ? point.equipped : [])
    .filter((id) => tracked.has(id))
  const fallback = player.inventory.filter((i) => i.equipped).map((i) => i.instanceId).filter((id): id is string => !!id && tracked.has(id))
  const ids = wanted.length ? wanted : fallback
  const exoticFirst = new Set(held.filter((h) => h.exotic).map((h) => h.instanceId))
  const order = [...ids.filter((id) => !exoticFirst.has(id)), ...ids.filter((id) => exoticFirst.has(id))]
  const sub = point?.characterId === charId ? point.subclass : undefined
  if (order.length || sub) {
    progress('Equipping your run setup…')
    try {
      const art = point?.characterId === charId ? point.artifact : undefined
      const r = await api<{ equipResults?: { itemInstanceId: string; equipStatus: number }[] }>('/Destiny2/Actions/Items/EquipItems/', { itemIds: [...(sub ? [sub.itemId] : []), ...(art ? [art.itemId] : []), ...order], characterId: charId, membershipType: mem.membershipType })
      const failed = (r.equipResults ?? []).filter((x) => x.equipStatus !== 1)
      report.equip = failed.length ? 'partial' : 'done'
      if (failed.some((f) => f.equipStatus === 1634)) report.equip = 'location'
      // Subclass and artifact sockets back to how they were.
      for (const target of report.equip === 'location' ? [] : [sub, art]) {
        if (!target || report.equip === 'location') continue
        const now = p.itemComponents?.sockets?.data?.[target.itemId]?.sockets ?? []
        for (const [socketIndex, plugItemHash] of target.plugs) {
          if (now[socketIndex]?.plugHash === plugItemHash) continue
          try {
            await api('/Destiny2/Actions/Items/InsertSocketPlugFree/', { plug: { socketIndex, socketArrayType: 0, plugItemHash }, itemId: target.itemId, characterId: charId, membershipType: mem.membershipType })
          } catch (e) {
            if (wrongPlace(e)) { report.equip = 'location'; break }
            report.equip = 'partial'
          }
        }
      }
    } catch (e) {
      if (noScope(e)) throw new BungieError(actionMessage(e))
      if (wrongPlace(e)) report.equip = 'location'
      else { report.equip = 'partial'; report.problems.push(`Equip: ${actionMessage(e)}`) }
    }
  }
  // 4. Whatever the equip swapped out goes to the Vault too.
  if (report.equip === 'done' || report.equip === 'partial') { p = await read(); await vaultExtras() }
  return report
}

// ------------------------------------------------------------------ send a seat's setup to the game

export const LOCATION_MESSAGE = 'You’re in an activity. Bungie only lets apps change your subclass and artifact in orbit, a social space like the Tower or H.E.L.M., or while you’re offline. Go to orbit and try again.'

export type SendReport = {
  character: string; applied: string[]; already: string[]; problems: string[]
  /** The character's equipped weapons and armor as read at send time, with instance ids. */
  gear: { slot: Slot; name: string; rarity: Rarity; instanceId?: string }[]
}

/**
 * Applies a seat's setup to the active character: switches to the seat's subclass, slots its
 * Super, class ability, melee and grenade, empties every aspect and fragment socket, and empties the artifact's
 * perk sockets. Bungie only allows this in orbit, a social space, or while offline.
 */
export async function sendSetup(seat: { cls: ClassType; element: Element; abilities: string[]; artifact?: string }, progress: (msg: string) => void): Promise<SendReport> {
  const [{ mem }, items] = await Promise.all([membership(), itemTable()])
  const p = await api<ProfileResponse>(`/Destiny2/${mem.membershipType}/Profile/${mem.membershipId}/?components=200,201,204,205,305,310`)
  const picked = pickFor(p, seat.cls)
  if (!picked) throw new BungieError('No characters found on this account.')
  const charId = picked.id
  const gear = (p.characterEquipment?.data?.[charId]?.items ?? [])
    .flatMap((i) => { const row = items[i.itemHash]; return row ? [{ slot: ALL_SLOTS[row[1]], name: row[0], rarity: TIERS[row[2]], instanceId: i.itemInstanceId }] : [] })
  const cls = CLASS_NAME[picked.char.classType]
  if (cls !== seat.cls) throw new BungieError(`Your active character is your ${cls}. Switch to your ${seat.cls} in game, or change this seat to ${cls}.`)
  const report: SendReport = { character: `${cls}, ${picked.char.light} Power`, applied: [], already: [], problems: [], gear }
  const act = (path: string, body: object) => api(path, { ...body, characterId: charId, membershipType: mem.membershipType }).catch((e) => {
    if (wrongPlace(e)) throw new BungieError(LOCATION_MESSAGE)
    if (noScope(e)) throw new BungieError(actionMessage(e))
    throw e
  })
  const insert = (itemId: string, socketIndex: number, plugItemHash: number) =>
    act('/Destiny2/Actions/Items/InsertSocketPlugFree/', { plug: { socketIndex, socketArrayType: 0, plugItemHash }, itemId })

  // 1. The seat's subclass, equipped.
  const subs = [
    ...(p.characterEquipment?.data?.[charId]?.items ?? []).filter((i) => i.bucketHash === SUBCLASS_BUCKET).map((i) => ({ i, equipped: true })),
    ...(p.characterInventories?.data?.[charId]?.items ?? []).filter((i) => i.bucketHash === SUBCLASS_BUCKET).map((i) => ({ i, equipped: false })),
  ]
  const named = await Promise.all(subs.map(async (x) => ({ ...x, name: await defName(x.i.itemHash) })))
  const sub = named.find((x) => x.name && (seat.element === 'Prismatic' ? x.name === `Prismatic ${cls}` : SUBCLASS_ELEMENT[x.name] === seat.element))
  if (!sub?.i.itemInstanceId) throw new BungieError(`Couldn’t find a ${seat.element} subclass on your ${cls}.`)
  const subId = sub.i.itemInstanceId
  if (!sub.equipped) {
    progress(`Switching to ${sub.name}…`)
    const r = await act('/Destiny2/Actions/Items/EquipItems/', { itemIds: [subId] }) as { equipResults?: { equipStatus: number }[] }
    if (r.equipResults?.some((x) => x.equipStatus === 1634)) throw new BungieError(LOCATION_MESSAGE)
    report.applied.push(sub.name!)
  }

  // 2. Sockets: work out what each one holds from its current plug.
  // Prismatic's own grenade sits in a separate socket that never changes, so it isn't a grenade choice here.
  const byName = new Map(subclassAbilities(cls, seat.element).filter((a) => !PRISMATIC_BASE_GRENADES.includes(a.name)).map((a) => [normName(a.name), a]))
  const wanted = new Map(seat.abilities.flatMap((n) => { const a = byName.get(normName(n)); return a ? [[a.kind, n] as const] : [] }))
  const current = p.itemComponents?.sockets?.data?.[subId]?.sockets ?? []
  const optionNamed = (idx: number) => socketOptions(p, sub.i, idx)
  type Job = { idx: number; kind: 'fragment' | 'aspect' | StarterKind; name: string }
  const jobs: Job[] = []
  await Promise.all(current.map(async (sock, idx) => {
    const def = sock.plugHash ? await itemDef(sock.plugHash) : null
    const name = def?.displayProperties?.name?.trim() ?? ''
    // The plug's category says which socket this is (warlock.prism.grenades, shared.prism.fragments…);
    // names alone can't, since a Prismatic grenade is also listed among that subclass's grenades.
    const kind = socketKind(def?.plug?.plugCategoryIdentifier)
      ?? (/^Empty Aspect/i.test(name) ? 'aspect' : /^Empty Fragment/i.test(name) ? 'fragment' : byName.get(normName(name))?.kind)
    if (kind && kind !== 'other' && kind !== 'aspect' && kind !== 'fragment' && wanted.get(kind) && normName(wanted.get(kind)!) !== normName(name)) jobs.push({ idx, kind, name: wanted.get(kind)! })
    if ((kind === 'aspect' || kind === 'fragment') && !/^Empty/i.test(name)) jobs.push({ idx, kind, name })
  }))
  // Fragments first (aspects decide how many fragment sockets there are), then aspects, then abilities.
  const rank = { fragment: 0, aspect: 1, super: 2, class: 3, melee: 4, grenade: 5 }
  jobs.sort((a, b) => rank[a.kind] - rank[b.kind] || b.idx - a.idx)
  for (const kind of STARTER_KINDS) {
    if (wanted.get(kind) && !jobs.some((j) => j.kind === kind)) report.already.push(`${wanted.get(kind)} already slotted`)
  }
  if (!jobs.some((j) => j.kind === 'aspect')) report.already.push('Aspects already empty')
  if (!jobs.some((j) => j.kind === 'fragment')) report.already.push('Fragments already empty')
  for (const job of jobs) {
    const opts = await optionNamed(job.idx)
    const target = job.kind === 'aspect' || job.kind === 'fragment'
      ? opts.find((o) => /^Empty/i.test(o.name))
      : opts.find((o) => normName(o.name) === normName(job.name))
    if (!target) { report.problems.push(job.kind === 'aspect' || job.kind === 'fragment' ? `Couldn’t empty ${job.name}` : `${job.name} isn’t available to slot`); continue }
    progress(job.kind === 'aspect' || job.kind === 'fragment' ? `Removing ${job.name}…` : `Slotting ${job.name}…`)
    try { await insert(subId, job.idx, target.hash); report.applied.push(job.kind === 'aspect' || job.kind === 'fragment' ? `Removed ${job.name}` : job.name) } catch (e) {
      if (e instanceof BungieError && e.message === LOCATION_MESSAGE) throw e
      // Bungie's profile can lag a change by a minute; a refused clear usually means it's already empty.
      if (job.kind === 'aspect' || job.kind === 'fragment') report.already.push(`${job.name} already removed`)
      else report.problems.push(`${job.name}: ${actionMessage(e)}`)
    }
  }

  // 3. The seat's artifact, equipped, with every perk off.
  let art = p.characterEquipment?.data?.[charId]?.items.find((i) => i.bucketHash === ARTIFACT_BUCKET)
  const artName = art ? await defName(art.itemHash) : null
  if (seat.artifact && (!artName || normName(artName) !== normName(seat.artifact))) {
    const held = (p.characterInventories?.data?.[charId]?.items ?? []).filter((i) => i.bucketHash === ARTIFACT_BUCKET && i.itemInstanceId)
    const names = await Promise.all(held.map((i) => defName(i.itemHash)))
    const found = held.find((_, k) => names[k] && normName(names[k]!) === normName(seat.artifact!))
    if (!found) report.problems.push(`${seat.artifact} isn’t on your ${cls}, so it couldn’t be equipped. Switch to it in game.`)
    else {
      progress(`Equipping ${seat.artifact}…`)
      const r = await act('/Destiny2/Actions/Items/EquipItems/', { itemIds: [found.itemInstanceId] }) as { equipResults?: { equipStatus: number }[] }
      if (r.equipResults?.some((x) => x.equipStatus === 1634)) throw new BungieError(LOCATION_MESSAGE)
      if (r.equipResults?.some((x) => x.equipStatus !== 1)) report.problems.push(`${seat.artifact} couldn’t be equipped. Switch to it in game.`)
      else { report.applied.push(seat.artifact); art = found }
    }
  }
  if (art?.itemInstanceId) {
    const artItem = art
    const artSockets = p.itemComponents?.sockets?.data?.[art.itemInstanceId]?.sockets ?? []
    let changed = false
    for (const [idx, sock] of artSockets.entries()) {
      const name = sock.plugHash ? (await defName(sock.plugHash)) ?? '' : ''
      if (!sock.plugHash || /^Empty/i.test(name)) continue
      const opts = await socketOptions(p, artItem, idx)
      const empty = opts.find((o) => /^Empty/i.test(o.name))?.hash ?? EMPTY_ARTIFACT_MOD
      progress(`Turning off ${name}…`)
      changed = true
      try { await insert(art.itemInstanceId, idx, empty); report.applied.push(`Turned off ${name}`) } catch (e) {
        if (e instanceof BungieError && e.message === LOCATION_MESSAGE) throw e
        report.already.push(`${name} already off`)
      }
    }
    if (!changed) report.already.push('Artifact perks already off')
  }
  return report
}
/** A subclass socket's kind from its plugs' category, or 'other' for sockets left alone (jump, Transcendence, Prismatic grenade). */
function socketKind(category?: string): AbilityKind | 'other' | undefined {
  if (!category) return undefined
  const m = /\.(supers|class_abilities|melee|grenades|aspects|fragments)$/.exec(category)
  return m ? ({ supers: 'super', class_abilities: 'class', melee: 'melee', grenades: 'grenade', aspects: 'aspect', fragments: 'fragment' } as const)[m[1] as 'supers'] : 'other'
}

/**
 * What a socket can take: the item's own reusable plugs (component 310) when Bungie sends them,
 * otherwise the socket's plug set from the item definition. Subclass sockets only have the latter.
 */
async function socketOptions(p: ProfileResponse, item: ItemComponent, idx: number) {
  const own = (item.itemInstanceId ? p.itemComponents?.reusablePlugs?.data?.[item.itemInstanceId]?.plugs?.[idx] : undefined)?.map((o) => o.plugItemHash) ?? []
  let hashes = own
  if (!hashes.length) {
    const entry = (await itemDef(item.itemHash))?.sockets?.socketEntries?.[idx]
    hashes = [...(entry?.reusablePlugSetHash ? await plugSet(entry.reusablePlugSetHash) : []), ...(entry?.singleInitialItemHash ? [entry.singleInitialItemHash] : [])]
  }
  return Promise.all([...new Set(hashes)].map(async (hash) => ({ hash, name: (await defName(hash)) ?? '' })))
}

/** "Empty Artifact Mod", the plug an unused artifact perk socket holds. */
const EMPTY_ARTIFACT_MOD = 1235188590

// ------------------------------------------------------------------ item preview (DIM-style, basic)

/** Stats in the order DIM and the game list them; bars for scaled stats, plain numbers for the rest. */
const ARMOR_STATS: [hash: number, name: string, bar: boolean][] = [
  [2996146975, 'Weapons', true], [392767087, 'Health', true], [1943323491, 'Class', true],
  [1735777505, 'Grenade', true], [144602215, 'Super', true], [4244567218, 'Melee', true],
]
const WEAPON_STATS: [hash: number, name: string, bar: boolean][] = [
  [4284893193, 'Rounds Per Minute', false], [2961396640, 'Charge Time', false], [447667954, 'Draw Time', false],
  [3614673599, 'Blast Radius', true], [2523465841, 'Velocity', true], [2837207746, 'Swing Speed', true],
  [4043523819, 'Impact', true], [1240592695, 'Range', true], [209426660, 'Guard Resistance', true],
  [155624089, 'Stability', true], [943549884, 'Handling', true], [4188031367, 'Reload Speed', true],
  [1345609583, 'Aim Assistance', true], [2714457168, 'Airborne', true], [3555269338, 'Zoom', true],
  [1931675084, 'Ammo Generation', true], [2715839340, 'Recoil Direction', false], [3871231066, 'Magazine', false],
  [925767036, 'Ammo Capacity', false],
]
const INTRINSIC = 3956125808
const WEAPON_PERKS = 4241085061
const WEAPON_MODS = 2685412949
const ARMOR_PERKS = 3154740035
const ARMOR_MODS = 590099826
/** Plugs not worth showing in a basic preview. */
const NOISE = /^(Empty|Default |Kill Tracker|Crucible Tracker|Weapon Mod|Upgrade Masterwork|Upgrade Armor|Tracker Disabled|Locked )/i

export type PreviewPlug = { name: string; icon?: string; description?: string }
export type ItemPreview = {
  name: string
  type: string
  rarity: Rarity
  element?: DamageElement
  /** Weapons only. */
  ammo?: AmmoType
  power?: number
  icon?: string
  screenshot?: string
  flavor?: string
  /** False when the player has no copy on their account (shown from Bungie's definition instead). */
  owned: boolean
  armor: boolean
  /** `max` scales the bar: 100 for weapon stats, 45 for a single armor piece's stats. */
  stats: { name: string; value: number; bar: boolean; max: number }[]
  intrinsic?: PreviewPlug
  /** Weapons: selected perk in each perk column (barrel, magazine, traits, origin). Armor: archetype and other perks. */
  perks: PreviewPlug[]
  mods: PreviewPlug[]
}

export type AmmoType = 'Primary' | 'Special' | 'Heavy'
const AMMO: Record<number, AmmoType | undefined> = { 1: 'Primary', 2: 'Special', 3: 'Heavy' }

const IMG = (path?: string) => (path ? `https://www.bungie.net${path}` : undefined)
async function plugInfo(hash?: number): Promise<PreviewPlug | null> {
  if (!hash) return null
  const d = await itemDef(hash)
  const name = d?.displayProperties?.name?.trim()
  if (!name || NOISE.test(name)) return null
  return { name, icon: IMG(d?.displayProperties?.icon), description: d?.displayProperties?.description || undefined }
}

/**
 * Details of the player's own copies of these items (Vault first, then characters): the rolled
 * stats, intrinsic frame, selected perks and mods. Items not found are left out.
 */
export async function fetchItemPreviews(names: string[], cls?: ClassType, pinned: Record<string, string> = {}): Promise<Record<string, ItemPreview>> {
  const [{ mem }, items] = await Promise.all([membership(), itemTable()])
  const p = await api<ProfileResponse>(`/Destiny2/${mem.membershipType}/Profile/${mem.membershipId}/?components=102,201,205,300,304,305`)
  const all: ItemComponent[] = [
    ...(p.profileInventory?.data?.items ?? []).filter((i) => i.bucketHash === VAULT_BUCKET),
    ...Object.values(p.characterInventories?.data ?? {}).flatMap((c) => c.items),
    ...Object.values(p.characterEquipment?.data ?? {}).flatMap((c) => c.items),
  ]
  const out: Record<string, ItemPreview> = {}
  await Promise.all(names.map(async (name) => {
    // The highest-power copy, as that's the one a player would pick.
    const copies = all.filter((i) => i.itemInstanceId && items[i.itemHash]?.[0] === name)
    const power = (i: ItemComponent) => p.itemComponents?.instances?.data?.[i.itemInstanceId!]?.primaryStat?.value ?? 0
    // A pinned copy (an Exotic class item's offered roll) when there is one, else the highest power.
    const item = copies.find((i) => i.itemInstanceId === pinned[name]) ?? copies.sort((a, b) => power(b) - power(a))[0]
    // Not on the account (e.g. an Exotic only in Collections): describe it from its definition.
    const hash = item?.itemHash ?? Number(Object.keys(items).find((h) => items[h][0] === name && (cls === undefined || items[h][3] === 3 || items[h][3] === CLASS_TYPE[cls])))
    if (!hash || !items[hash]) return
    const id = item?.itemInstanceId
    const def = await itemDef(hash)
    const row = items[hash]
    const armor = row[1] >= 3
    const rolled = id ? p.itemComponents?.stats?.data?.[id]?.stats ?? {} : {}
    const stats = (armor ? ARMOR_STATS : WEAPON_STATS).filter(([h]) => rolled[h] !== undefined)
      .map(([h, n, bar]) => ({ name: n, value: rolled[h].value, bar, max: armor ? 45 : 100 }))
    if (armor && stats.length) stats.push({ name: 'Total', value: stats.reduce((t, x) => t + x.value, 0), bar: false, max: 0 })
    const sockets = id ? p.itemComponents?.sockets?.data?.[id]?.sockets ?? [] : []
    const entries = def?.sockets?.socketEntries ?? []
    const cat = (h: number) => def?.sockets?.socketCategories?.find((c) => c.socketCategoryHash === h)?.socketIndexes ?? []
    // The copy's plug where there is one, otherwise the definition's default.
    const at = (idxs: number[]) => Promise.all(idxs.map((i) => plugInfo(sockets[i]?.plugHash ?? entries[i]?.singleInitialItemHash))).then((x) => x.filter((v): v is PreviewPlug => !!v))
    let intrinsic: PreviewPlug | undefined, perks: PreviewPlug[], mods: PreviewPlug[]
    if (armor) {
      // The Exotic perk is the armor perk the definition fixes; anything else there (archetype) is a perk.
      const fixed = await at(cat(ARMOR_PERKS).filter((i) => entries[i]?.singleInitialItemHash))
      const all = await at(cat(ARMOR_PERKS))
      intrinsic = row[2] === 4 ? fixed[fixed.length - 1] : undefined
      perks = all.filter((x) => x.name !== intrinsic?.name)
      // An Exotic class item's two rolled perks.
      if (id) perks = [...await at(cat(EXOTIC_CLASS_PERKS)), ...perks]
      mods = id ? await at(cat(ARMOR_MODS)) : []
    } else {
      ;[[intrinsic], perks, mods] = await Promise.all([at(cat(INTRINSIC)), at(cat(WEAPON_PERKS)), at(cat(WEAPON_MODS))])
      if (!id) { perks = []; mods = [] }
    }
    const dmg = (id ? p.itemComponents?.instances?.data?.[id]?.damageType : undefined) ?? def?.defaultDamageType ?? row[4]
    out[name] = {
      name, type: def?.itemTypeDisplayName ?? ALL_SLOTS[row[1]], rarity: TIERS[row[2]], element: armor ? undefined : DAMAGE[dmg],
      ammo: armor ? undefined : AMMO[def?.equippingBlock?.ammoType ?? 0],
      power: (item && power(item)) || undefined, icon: IMG(def?.displayProperties?.icon), screenshot: IMG(def?.screenshot),
      flavor: def?.flavorText || undefined, owned: !!item, armor, stats, intrinsic, perks, mods,
    }
  }))
  return out
}

// ------------------------------------------------------------------ gear progression

/** Which of these items (in this slot, usable by this class) are anywhere on the account. */
export async function ownedInSlot(names: string[], slot: Slot, cls: ClassType): Promise<Set<string>> {
  const [{ mem }, items] = await Promise.all([membership(), itemTable()])
  const p = await api<ProfileResponse>(`/Destiny2/${mem.membershipType}/Profile/${mem.membershipId}/?components=102,201,205`)
  const want = new Set(names)
  const out = new Set<string>()
  for (const h of holdings(p, items)) {
    const row = items[h.itemHash]
    if (row && want.has(row[0]) && ALL_SLOTS[row[1]] === slot && (row[3] === 3 || row[3] === CLASS_TYPE[cls])) out.add(row[0])
  }
  return out
}

let tierPool: Promise<{ weapons: Record<string, Record<string, string[]>> }> | null = null
/** Uncommon and Rare weapons per slot that can be pulled from Collections (public/bungie-tiers.json). */
export function tierWeapons() {
  tierPool ??= fetch('/bungie-tiers.json').then((r) => (r.ok ? r.json() : { weapons: {} }), () => ({ weapons: {} }))
  return tierPool.then((t) => t.weapons ?? {})
}

// ------------------------------------------------------------------ run inventory moves (Vault ⇄ run character)

/** `slot` tells same-named pieces apart (an armor set's pieces share one name). */
export type MoveOp = { name: string; instanceId?: string; slot?: Slot; to: 'vault' | 'character' }
export type MoveResult = {
  character: string
  /** Items moved, as "Name → Vault" / "Name → Hunter". */
  moved: string[]
  problems: string[]
  /** Instance ids of items pulled to the character, by name, so the run can track the exact copy. */
  pulled: Record<string, string>
}

/**
 * Moves weapons and armor between the Vault and the player's run character (the character their
 * last clean sync recorded, else their most recently played one of the run's class). Items on
 * another character go via the Vault. Equipped items can't be moved; those are reported.
 */
export async function moveItems(player: Player, ops: MoveOp[]): Promise<MoveResult> {
  const [{ mem }, items] = await Promise.all([membership(), itemTable()])
  const p = await api<ProfileResponse>(`/Destiny2/${mem.membershipType}/Profile/${mem.membershipId}/?components=102,200,201,204,205,300`)
  const chars = p.characters?.data ?? {}
  const point = player.bungie?.restore
  const charId = point && chars[point.characterId]?.classType === CLASS_TYPE[player.cls] ? point.characterId : pickCharacter(p, player.cls)?.id
  if (!charId) throw new BungieError(`There's no ${player.cls} on this account.`)
  const out: MoveResult = { character: player.cls, moved: [], problems: [], pulled: {} }
  const held = holdings(p, items)
  const power = (h: Held) => p.itemComponents?.instances?.data?.[h.instanceId]?.primaryStat?.value ?? 0
  const used = new Set<string>()
  const move = (h: Held, toVault: boolean, characterId: string) =>
    api('/Destiny2/Actions/Items/TransferItem/', { itemReferenceHash: h.itemHash, stackSize: 1, transferToVault: toVault, itemId: h.instanceId, characterId, membershipType: mem.membershipType })

  for (const op of ops) {
    const fits = (h: Held) => {
      const row = items[h.itemHash]
      return !op.slot || (!!row && ALL_SLOTS[row[1]] === op.slot && (row[3] === 3 || row[3] === CLASS_TYPE[player.cls]))
    }
    const copies = held.filter((h) => !used.has(h.instanceId) && (op.instanceId ? h.instanceId === op.instanceId : h.name === op.name && fits(h)))
    // Pulling: the best copy not already on the character (Vault first). Vaulting: the copy on the character.
    const pick = op.to === 'character'
      ? copies.find((h) => h.where === charId) ?? copies.filter((h) => h.where !== 'postmaster').sort((a, b) => Number(b.where === 'vault') - Number(a.where === 'vault') || power(b) - power(a))[0]
      : copies.find((h) => h.where === charId && !h.equipped) ?? copies.find((h) => h.where !== 'vault' && h.where !== 'postmaster') ?? copies.find((h) => h.where === 'vault')
    if (!pick) { out.problems.push(op.to === 'character' ? `${op.name}: not on your account (claim it from Collections in game)` : `${op.name}: not found on your account`); continue }
    used.add(pick.instanceId)
    if (op.to === 'character' && pick.where === charId) { out.pulled[op.name] = pick.instanceId; out.moved.push(`${op.name} is already on your ${player.cls}`); continue }
    if (op.to === 'vault' && pick.where === 'vault') { out.moved.push(`${op.name} is already in the Vault`); continue }
    if (pick.equipped) { out.problems.push(`${op.name}: equipped${pick.where === charId ? '' : ' on another character'}; swap it out in game first`); continue }
    try {
      if (op.to === 'vault') await move(pick, true, pick.where)
      else {
        if (pick.where !== 'vault') await move(pick, true, pick.where)
        await move(pick, false, charId)
        out.pulled[op.name] = pick.instanceId
      }
      out.moved.push(`${op.name} → ${op.to === 'vault' ? 'Vault' : player.cls}`)
    } catch (e) {
      if (noScope(e)) throw new BungieError(actionMessage(e))
      out.problems.push(`${op.name}: ${actionMessage(e)}`)
    }
  }
  return out
}
