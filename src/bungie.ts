// Bungie sign-in and profile access (Mode B, Level 3 Integration).
// Tokens live only in this browser (localStorage). The client secret lives in the
// Netlify Function at /api/bungie-token. Only restoreGuardian moves or equips items,
// and only when the player asks for it.

import { ALL_SLOTS, ARTIFACTS, subclassAbilities, type AbilityKind, type ClassType, type DamageElement, type Element, type Rarity, type Slot, type VaultEntry } from './data'
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
  itemComponents?: {
    sockets?: { data?: Record<string, { sockets: { plugHash?: number; isEnabled?: boolean }[] }> }
    /** What each socket can take (component 310), by socket index. */
    reusablePlugs?: { data?: Record<string, { plugs: Record<string, { plugItemHash: number; canInsert?: boolean }[]> }> }
  }
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
  const [{ mem, name }, items] = await Promise.all([membership(), itemTable()])

  const p = await api<ProfileResponse>(`/Destiny2/${mem.membershipType}/Profile/${mem.membershipId}/?components=102,200,201,202,204,205,305`)
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
    subclass: charId ? await readSubclass(p, charId, cls).catch(() => null) : null,
    artifact: charId ? await readArtifact(p, charId).catch(() => null) : null,
    mintedAt: (() => { const m = p.secondaryComponentsMintedTimestamp ?? p.responseMintedTimestamp; return m ? Date.parse(m) : null })(),
    restore: charId ? restorePoint(p, charId, items) : null,
    emblem: char?.emblemPath && char.emblemBackgroundPath ? { icon: char.emblemPath, background: char.emblemBackgroundPath } : null,
  }
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
  items: { slot: Slot; name: string; rarity: Rarity }[]
  /** When Bungie produced the inventory data (it can lag the game by a minute or more). */
  mintedAt: number | null
  fetchedAt: number
}

/** What the active character has equipped right now, for the lobby preview. */
export async function fetchEquipped(): Promise<EquippedPreview> {
  const [{ mem, name }, items] = await Promise.all([membership(), itemTable()])
  const p = await api<ProfileResponse>(`/Destiny2/${mem.membershipType}/Profile/${mem.membershipId}/?components=200,202,204,205,305`)
  const picked = pickCharacter(p)
  if (!picked) throw new BungieError('No characters found on this account.')
  const { id, char: c, online } = picked
  const equipped = (p.characterEquipment?.data?.[id]?.items ?? [])
    .map((i) => items[i.itemHash])
    .filter((r): r is ItemRow => !!r)
    .map((r) => ({ slot: ALL_SLOTS[r[1]], name: r[0], rarity: TIERS[r[2]] }))
    .sort((a, b) => ALL_SLOTS.indexOf(a.slot) - ALL_SLOTS.indexOf(b.slot))
  const minted = p.secondaryComponentsMintedTimestamp ?? p.responseMintedTimestamp
  const cls = CLASS_NAME[c.classType] ?? 'Hunter'
  return { name, cls, light: c.light, online, items: equipped, subclass: await readSubclass(p, id, cls).catch(() => null), artifact: await readArtifact(p, id).catch(() => null), mintedAt: minted ? Date.parse(minted) : null, fetchedAt: Date.now() }
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
type ItemDef = { displayProperties?: { name?: string }; sockets?: { socketEntries?: { singleInitialItemHash?: number; reusablePlugSetHash?: number }[] } }
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
 * Super, melee and grenade, empties every aspect and fragment socket, and empties the artifact's
 * perk sockets. Bungie only allows this in orbit, a social space, or while offline.
 */
export async function sendSetup(seat: { cls: ClassType; element: Element; abilities: string[]; artifact?: string }, progress: (msg: string) => void): Promise<SendReport> {
  const [{ mem }, items] = await Promise.all([membership(), itemTable()])
  const p = await api<ProfileResponse>(`/Destiny2/${mem.membershipType}/Profile/${mem.membershipId}/?components=200,201,204,205,305,310`)
  const picked = pickCharacter(p)
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
  const byName = new Map(subclassAbilities(cls, seat.element).map((a) => [normName(a.name), a]))
  const wanted = new Map(seat.abilities.map((n) => [byName.get(normName(n))?.kind, n] as const))
  const current = p.itemComponents?.sockets?.data?.[subId]?.sockets ?? []
  const optionNamed = (idx: number) => socketOptions(p, sub.i, idx)
  type Job = { idx: number; kind: 'fragment' | 'aspect' | 'super' | 'melee' | 'grenade'; name: string }
  const jobs: Job[] = []
  await Promise.all(current.map(async (sock, idx) => {
    const name = sock.plugHash ? (await defName(sock.plugHash)) ?? '' : ''
    const kind = /^Empty Aspect/i.test(name) ? 'aspect' : /^Empty Fragment/i.test(name) ? 'fragment' : byName.get(normName(name))?.kind
    if (kind && kind !== 'aspect' && kind !== 'fragment' && wanted.get(kind) && normName(wanted.get(kind)!) !== normName(name)) jobs.push({ idx, kind, name: wanted.get(kind)! })
    if ((kind === 'aspect' || kind === 'fragment') && !/^Empty/i.test(name)) jobs.push({ idx, kind, name })
  }))
  // Fragments first (aspects decide how many fragment sockets there are), then aspects, then abilities.
  const rank = { fragment: 0, aspect: 1, super: 2, melee: 3, grenade: 4 }
  jobs.sort((a, b) => rank[a.kind] - rank[b.kind] || b.idx - a.idx)
  for (const kind of ['super', 'melee', 'grenade'] as const) {
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
