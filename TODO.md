# To do

The owner's list of planned and parked work. Nothing here is started until the owner says so.

## Planned

- [ ] **Bungie API recorder (nightly test tools only).** Find out whether the API can tell when an
  encounter is cleared. While signed in and playing a dungeon, record every 30 s whatever changed:
  current activity, weekly milestone checkpoints ("phases") for the dungeon, recent activity
  history, the end-of-activity report (completion, kills and deaths per player) and new item drops.
  Buttons to mark what really happened ("Encounter cleared now", "Wipe", "Death") with timestamps,
  and "Download log" to send the file over. Never include sign-in tokens or secrets. Try it on the
  weekly featured dungeon and one that isn't, ideally with every fireteam member recording.
  Then decide which signals are reliable enough for:
  - [ ] a "Looks like an encounter just finished. Record the clear?" prompt for the host when loot
    drops mid-dungeon (prompt only, never recorded automatically);
  - [ ] checking the final boss was recorded once Bungie reports the dungeon complete;
  - [ ] pre-filling or cross-checking deaths from the end-of-activity report.

## Parked

- [ ] Saved loadouts and the Vault pool panel (built but hidden).
- [ ] Sandbox editor: starting artifact perks; which gear slots count towards limits.
- [ ] Explainer: mention custom Directives (it shows Standard Directive's numbers).
- [ ] Ultrawide screens: the run page is a ~1340 px column; widen it or add a column?
- [ ] Bug reports sent from the start screen with "attach run data" ticked show an empty `null`
  run-data section.
- [ ] A real session on nightly with friends: resume and restore, duplicate copies, guest restore.
