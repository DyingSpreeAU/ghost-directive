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

- **Lobby**: Protocol Ruleset (snapshot locked per run), up to 3 seats with host, each player
  picks their committed subclass, starting Super/melee/grenade and starting-gear checklist on
  their own device; host picks the chronological or custom expedition (route locks on start).
- **Mission Briefing**: shared Fireteam Integrity, current encounter with generated destination
  art and route progress, three player panels with unlocks and slot capacity, host actions.
- **Record Clear** flow: Integrity reward (capped), three-choice subclass unlock per player,
  final-boss category-first reward (Exotic armor or Vault Legendary weapon), final-boss
  Artifact research, drop registration, then advance. One completion reward per encounter.
- **Host actions are two buttons.** The contextual Progress button records a clear. When secret
  chests sit before the next encounter (`chestsAfter` in `src/data.ts`), it splits into
  found / skipped. Each chest found gives every player a chest reward (Artifact research or a
  rare upgrade). **Record Wipe** asks for confirmation, and the run fails at 0 Integrity.
- **Field Arsenal**: 8 slots, configurable capacity, guided swap or warn-only overflow,
  move-to-Vault (no dismantling), 4→1 trade-up with 5 Vault options, saved loadouts that go
  invalid when an item leaves, per-player Vault pool (an example pool stands in until entered).
- **Subclass Archive** separates unlocked from equipped-in-game and flags out-of-order abilities.
- **Combat Report**, **Run History**, and a **Protocol editor** (customize, duplicate,
  export/import JSON) with validation.
- State persists in `localStorage`. First launch loads a clearly marked example run.

## Not yet built (per spec roadmap / open questions)

- Mode B, Level 3 Bungie API integration (Phase 4).
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

## Game data

`src/compendium.ts` is generated; don't edit it by hand. It holds every subclass's Supers,
grenades, melees, aspects and fragments (Prismatic included), each with a one-line description,
plus every Exotic armor piece with its perk and slot.

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
