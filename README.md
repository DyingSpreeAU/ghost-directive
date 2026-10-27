# Ghost Directive

A companion web app for a self-imposed Destiny 2 roguelite challenge, built from the
*Ghost Directive Project Design Specification*. Players play Destiny 2 normally; the app
guides setup, tracks run state, presents rewards and choices, and warns about discrepancies.
It never enforces rules inside the game.

## Run it

```sh
npm install
npm run dev          # local dev server
npm run build        # production build in dist/
SINGLE=1 npx vite build --outDir dist-single   # one self-contained HTML file
```

## Lobbies and multiplayer

- The **host's browser is the only place a run is stored** (`localStorage`). Closing the
  window is safe: reopening offers "Resume hosting", and a reload of the hosting tab resumes
  automatically.
- Players join with a random **6-character lobby code**. They keep only a device id in
  `sessionStorage`, so a reload puts them back on their own Guardian.
- The host is authoritative. It broadcasts the whole state (gzip, chunked to fit 4 KiB
  messages). Players send *intents* about their own Guardian only, and the host validates and
  applies them (`applyIntent` / `applyLobbyIntent` in `src/model.ts`).
- **Record Clear** rolls every player's options on the host and stores them as pending
  rewards. Each player resolves theirs on their own device: unlock, final-boss item, Artifact
  research, chest reward, and their own drops. The run advances right away.
- Transport (`src/net.ts`): inside a claude.ai artifact it uses the `room` capability.
  Players need Contributor access to send. Anywhere else it uses PeerJS (WebRTC via the
  public PeerJS broker).
- Guardians with no device linked can be run by the host, for players without a device.

## What's implemented (manual "No Login" mode)

- **Lobby**: Protocol Ruleset (snapshot locked per run), up to 3 seats with host. Each player picks
  their committed subclass, starting Super/melee/grenade and **artifact** on their own device; no one
  can ready up or start without an artifact. Starting-gear rules are shown as instructions (nothing
  to tick). Starting weapons may be grey or green; armor grey. Prismatic seats always have their
  class's Prismatic grenade (Freezing Singularity, Hailfire Spike or Electrified Snare) as base kit,
  so it's unlocked from the start and not offered as the starting grenade. The host picks the
  chronological expedition (defaults to every dungeon) or a custom one; the route locks on start.
- **Artifacts** (7, from the compendium's Artifact Perks tab, 21 perks each in three tiers): all
  Artifact research (final bosses and secret chests) offers perks from the player's chosen artifact only.
- **Mission Briefing**: shared Fireteam Integrity, current encounter with generated destination
  art and route progress, three player panels with unlocks and slot capacity, host actions.
- **Record Clear** flow: Integrity reward (capped), three-choice subclass unlock per player,
  final-boss category-first reward (Exotic armor or Vault Legendary weapon), final-boss
  Artifact research, drop registration, then advance. One completion reward per encounter.
- **Host actions are two buttons.** Progress records an encounter clear: Integrity changes and
  every player's reward screen opens straight away. Then, for each secret chest before the next
  encounter (positions from `DUNGEONS` in `src/data.ts`), Progress asks "Did you get Secret Chest N?"
  with Got it / Missed it, one chest at a time. Chests at the start of a dungeon are asked before
  its first encounter. A found chest gives every player a chest reward. **Record Wipe** asks for
  confirmation, and the run fails at 0 Integrity.
- **Field Arsenal**: 8 slots, configurable capacity, guided swap or warn-only overflow,
  move-to-Vault (no dismantling), 4→1 trade-up with 5 Vault options. Signed-in players get a
  **Sync drops now** button. Saved loadouts and the Vault pool editor are hidden for now (the code
  stays in `src/Briefing.tsx`); the Vault pool still feeds reward choices. With loadouts hidden, the
  Loadout Archive chest reward, loadout warnings and the protocol's loadout-slot setting are off too.
- **Subclass Archive** separates unlocked from equipped-in-game and flags out-of-order abilities.
- **Saved runs**: every unfinished run is kept in the host's browser (`saved` in the host store,
  localStorage; the app asks the browser for persistent storage). Starting a new lobby or switching
  runs puts the current one aside instead of ending it. The start screen lists them with route
  progress, Integrity, Guardians and last played, and offers Resume or Delete (deleting is permanent).
  Ending a run from the Briefing still archives it to Run History.
- **Players are matched by Bungie account.** Each device sends its Bungie.net account id with its
  lobby messages; the host stores it on the seat and the Guardian (`bungieId`). A signed-in player
  coming back on a new device or session is put back on their Guardian automatically once the old
  device has been gone ~15 s. No claim screen.
- **Combat Report**, **Run History**, and a **Protocol editor** (customize, duplicate,
  export/import JSON) with validation.
- State persists in `localStorage`. First launch loads a clearly marked example run.

## Not yet built (per spec roadmap / open questions)

- Bungie item transfers (Vault ↔ character). Sign-in and read-only sync are done.
- Permanent cross-run upgrades and an Artifact capacity rule.

## Hosting outside claude.ai (Netlify etc.)

`npm run build` and deploy `dist/`. Lobbies then connect browsers directly with WebRTC via
PeerJS. By default this uses the free public PeerJS signalling server and public STUN servers.
These optional build-time environment variables change that (set them in Netlify under Site
configuration → Environment variables, then redeploy):

| Variable | Purpose |
| --- | --- |
| `VITE_PEERJS_HOST`, `VITE_PEERJS_PORT`, `VITE_PEERJS_PATH`, `VITE_PEERJS_SECURE` | Use your own [PeerServer](https://github.com/peers/peerjs-server) instead of the public one. |
| `VITE_TURN_URLS` (comma-separated), `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | Add a TURN relay for players whose network blocks direct connections. |
| `VITE_PEERJS_DEBUG` | `1`–`3` logs PeerJS detail to the browser console. |

The join screen says which stage a player is stuck on: reaching the lobby server, finding the
lobby, or opening the direct connection to the host.

## Bungie sign-in (Netlify build)

Players can sign in with Bungie so reward choices come from their real Vault. This is read-only:
nothing is moved or equipped. Each player signs in on their own device, and their tokens stay in
that browser. The player's device reads their profile and sends the host:

- their eligible Vault Legendaries (weapons, plus armor for their class);
- tracked run items not found anywhere on the account;
- items equipped on their character that aren't in the run inventory.

The host turns the last two into warnings.

**Lobby: Equipped now.** Signed-in players see their active character (the one in game now, or else the most recently
played) with its equipped weapons, armor and subclass, checked against the starting rules
(including no aspects or fragments). The panel refreshes every minute and has a
Refresh button. Hovering "Updated X ago" shows when Bungie generated the data (the profile's
minted timestamp), since it can lag the game. Until the gear matches, the panel, the Ready button
and the host's begin bar say to wait: the run records equipped gear as starting gear, and anything
new after that counts as a drop. The seat is filled once from the character (class, subclass,
Super, melee, grenade from the equipped subclass's sockets) unless the player already set it up.
"Use my character's setup" re-applies it.

**Abilities.** During a run each sync reads the equipped subclass and what's slotted in it. That
replaces the manual "equipped" ticks in the Subclass Archive, and anything equipped that isn't
unlocked in the run (players start with only their Super, melee and grenade) shows "Equipped but
not unlocked". A different subclass from the one the run is committed to is also flagged.

**Automatic drops.** On a signed-in player's first sync of a run, their device records every
weapon and armor instance on the account as a baseline, and registers what their character has
equipped as starting gear. From then on, any new instance (checked every minute during a run
and about 45 s after each clear) is registered as a detected drop. Transfers keep the same
instance ID, so they don't count. Pulling a fresh copy from Collections does count; players can
remove a wrong entry with **Remove**, which changes only the app (the item stays in Destiny 2)
and stops it being detected again. Signed-in players skip the manual drops step. This is a
convenience, not anti-cheat. The baseline lives in the player's browser
(`ghost-directive:drop-baseline:<run>:<player>`), and a lost sync is re-sent next time.

**Artifact.** Syncs also read the character's equipped artifact (the item in the artifact bucket, 1506418338, and the perks in its sockets; the seasonal-artifact progression, component 202, is only a fallback because it keeps reporting the season's default artifact) and its
active perks. In the lobby the seat's artifact defaults to the equipped one, and the "Equipped now"
preview flags perks still switched on. During a run, a different artifact from the seat's choice, or
an active perk that hasn't been researched in the run, is flagged.

**Sync from / Send to** (your seat in the lobby). *Sync from* fills the seat from your active
character. *Send to* does the reverse with the move/equip scope: it switches the active character to
the seat's subclass, slots its Super, melee and grenade, empties every aspect and fragment socket,
and empties the artifact's perk sockets (InsertSocketPlugFree, using component 310 to find each
socket's options), and equips the seat's artifact if the character holds it. Bungie only allows it in orbit, a
social space or while offline; in an activity it stops and explains why.

**Restore my Guardian** (Field Arsenal, signed-in players). Each sync where everything equipped is
part of the run and the subclass matches records a restore point: the character, the equipped
instance ids, the subclass's socket plugs and the artifact with its perks (`BungieLink.restore`). Syncs while playing other gear
leave it alone. Restore then, on the run's character: sends weapons and armor that aren't in the run
inventory to the Vault, pulls run items from the Vault or other characters (manual entries are matched
by name), equips the restore point (subclass first, Exotics last) and re-slots the subclass, then
vaults whatever the equip swapped out. Bungie only equips in orbit, a social space or while offline;
moving works anywhere, and the result says which happened. Postmaster items and items equipped on
another character are reported, not moved. Needs the app scope below.

**Synaptic Link.** A Ghost icon at the top right of every lobby and run page shows the Bungie link:
green when signed in and the last read succeeded within 5 minutes, red otherwise (signed out, an
API error, or no recent read). It's status only. Hovering explains it and offers sign in or sign out.

**Bungie app** (bungie.net/en/Application): OAuth Client Type *Confidential*; Redirect URL
`https://<site>/auth/callback`; scopes *Read your Destiny 2 information* and *Move or equip Destiny gear* (the second is only for
Restore my Guardian; after adding it, players sign out and back in); Origin Header
`https://<site>`.

**Netlify environment variables**

| Key | Value |
| --- | --- |
| `VITE_BUNGIE_API_KEY` | API Key (public; Bungie restricts it to the Origin Header) |
| `VITE_BUNGIE_CLIENT_ID` | OAuth client_id |
| `BUNGIE_CLIENT_SECRET` | OAuth client_secret. **No `VITE_` prefix**: only the function reads it |
| `BUNGIE_API_KEY` | API Key, for the function |

`netlify/functions/bungie-token.mjs` (served at `/api/bungie-token`) exchanges sign-in codes
and refresh tokens. `netlify.toml` routes `/auth/callback` to the app. `public/bungie-items.json`
maps item hashes to names, slots and rarities; regenerate it with `tools/fetch_sources.py` after
game updates. Without the `VITE_BUNGIE_*` variables (including the claude.ai build) the sign-in
code is left out entirely.

## Game data

`src/compendium.ts` is generated; don't edit it by hand. It holds every subclass's Supers,
grenades, melees, aspects and fragments (Prismatic included), each with a one-line description,
every Exotic armor piece with its perk and slot (no Exotic class items for now), and the
artifacts with their perks.

- **Destiny Data Compendium** (Google Sheet): ability names, descriptions, Facets, Prismatic
  grenades, Exotic armor names and perks.
- **Bungie manifest**: Exotic armor slots, and which abilities each Prismatic subclass can
  socket. It is also used to cross-check the sheet's element subclasses.
- Exotic subclass synergy is inferred from each perk's text (an element or ability name).
  Exotics that mention none count as general picks.

To regenerate after a game update (needs docs.google.com and *.bungie.net access):

```sh
python3 tools/fetch_sources.py /tmp/gd-sources
python3 tools/parse_compendium.py /tmp/gd-sources src/compendium.ts
```

Dungeon layouts (`DUNGEONS` in `src/data.ts`) are written in play order, for example `['C', 'E:Phry’zhia The Insatiable', ...]`: `E:` is an encounter, `F:` the final boss, and `C` a secret chest. Chest positions are worked out from that order.

## Code map

- `src/data.ts` – game data access (from `src/compendium.ts`), example Vault, Artifact mods, dungeons.
- `tools/` – fetch and parse scripts that generate `src/compendium.ts`.
- `src/model.ts` – rulesets, run state, reward generation, compliance warnings.
- `src/net.ts` – lobby codes, transports (claude.ai room / PeerJS), chunked snapshots.
- `src/App.tsx` – landing, host and player apps, shell, automatic reward/swap prompts.
- `src/Lobby.tsx` – lobby screen.
- `src/Briefing.tsx`, `src/Flows.tsx`, `src/Protocols.tsx`, `src/History.tsx` – screens.
