# Easter eggs

Every easter egg in Ghost Directive: what triggers it, what it does, and where it lives. Add new
ones here when they're built.

| Egg | Trigger | What happens | Who sees it | Code | Try it |
|---|---|---|---|---|---|
| **Wanted poster** | The missing-gear pop-up opens (a Bungie sync can't find run items on any character or in the Vault). 1 in 10,000 of those pop-ups. | The pop-up is drawn as a sepia wanted poster: "Have you seen these items?!", a WANTED card per item, "Reward: 5 Glimmer". Same buttons and result as the normal pop-up. | That player | `MissingFlow` and `WANTED_ODDS` in `src/Flows.tsx`; `.modal-wanted` / `.wanted-*` in `src/index.css` | Nightly test tools: **Wanted poster** |
| **Zorpalod** | A Guardian names themselves "Zorpalod" (seat name in the lobby, or their name in the run; any capitals, spaces around it ignored). | Every image in the app becomes a soggy owl (`public/easter/zorpalod.webp`), including Bungie emblems. Renaming puts the real images back. | Only that player's own device | `src/easterEggs.ts` (`useZorpalod`, called in the shell in `src/App.tsx`); `html.zorpalod` in `src/index.css` | Name your seat Zorpalod |
