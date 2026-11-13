import { test, expect, exampleRun, tools, toolsForMe, later, store, fresh, collapseTools, editStore, pickArmor, startRun } from './helpers'

test('a drop below Legendary raises the tier, names the piece, and is recorded as used for a tier-up', async ({ page }) => {
  await exampleRun(page)
  await tools(page, async () => { await toolsForMe(page); await page.click('.devtools button:has-text("Add a drop")') })
  await expect(page.locator('.modal h2')).toContainText('Kinetic')
  const steps = page.locator('.upgrade-steps')
  await expect(steps.locator('li').first()).toContainText('Dismantle or vault')
  // The piece is named by its weapon type, not "weapon".
  await expect(steps.locator('li').nth(1)).toContainText(/an? \w+ kinetic (Auto Rifle|Scout Rifle|Pulse Rifle|Hand Cannon|Sidearm|Submachine Gun|Shotgun|Sniper Rifle|Combat Bow|Fusion Rifle|Glaive|Trace Rifle)/)
  const fates = (await store(page)).active.players.flatMap((p: { retired?: { fate: string }[] }) => (p.retired ?? []).map((r) => r.fate))
  expect(fates).toContain('tiered')
  await page.click('.modal-foot .btn-light')
  await later(page)
  // The example's Kinetic is already Uncommon, so this drop takes it to Rare.
  await expect(page.locator('.guardian').first().locator('.g-slot').first().locator('.g-slot-head')).toContainText('Rare')
})

test('armor tier pieces are named by piece', async ({ page }) => {
  await exampleRun(page)
  await tools(page, async () => { await toolsForMe(page); await page.selectOption('.devtools select[aria-label="Slot"]', 'Helmet'); await page.click('.devtools button:has-text("Add a drop")') })
  await expect(page.locator('.modal h2')).toContainText('Helmet')
  await expect(page.locator('.upgrade-steps li').nth(1)).toContainText(/an? \w+ Helmet\./)
})

test('BONUS lets the player raise any slot', async ({ page }) => {
  await exampleRun(page)
  await tools(page, async () => { await toolsForMe(page); await page.click('.devtools button:has-text("Chest + BONUS")') })
  await page.click('.modal .choice >> nth=0')
  await page.click('.modal-foot .btn-light')
  await expect(page.locator('.bonus-banner')).toBeVisible()
  await expect(page.locator('.modal h2')).toContainText('BONUS')
})

test('armor tiers: each Guardian must choose; simulated armor keeps the grey piece and shows the tier', async ({ page }) => {
  await fresh(page)
  await page.click('text=Create lobby')
  await collapseTools(page)
  await page.click('.seat.is-you .art-pick [role=radio][title^="Tablet of Ruin"]')
  await expect(page.locator('.begin-bar')).toContainText('Every Guardian picks real or simulated armor tiers')
  await expect(page.locator('button:has-text("Begin run")')).toBeDisabled()
  await expect(page.locator('.seat.is-you .armor-tiers .at-row')).toHaveCount(2)
  // Every step has a real icon, and they follow the seat's class.
  const pics = page.locator('.seat.is-you .armor-tiers img')
  await expect(pics).toHaveCount(8)
  const before = await pics.first().getAttribute('src')
  await page.click(`.seat.is-you [aria-label="Class"] button:not([aria-checked="true"])`)
  await expect(pics.first()).not.toHaveAttribute('src', before!)
  await pickArmor(page, 'Simulated')
  await page.click('button:has-text("Begin run")')
  await page.waitForSelector('#arsenal')
  expect((await store(page)).active.players[0].armorTiers).toBe('simulated')
  await expect(page.locator('.guardian').first().locator('.tag-sim')).toBeVisible()
  await editStore(page, "s.active.players[0].inventory.push({ id: 'h1', name: 'Daring Hunter Mask', slot: 'Helmet', rarity: 'Common', equipped: true, source: 'starting gear' })")
  // A Legendary helmet drop raises the slot: put the drop away, keep wearing the grey helmet.
  await tools(page, async () => { await toolsForMe(page); await page.selectOption('.devtools select[aria-label="Slot"]', 'Helmet'); await page.click('.devtools button:has-text("Add a drop")') })
  const steps = page.locator('.upgrade-steps')
  await expect(steps.locator('li')).toHaveCount(2)
  await expect(steps.locator('li').nth(1)).toContainText('Keep wearing your helmet')
  await page.click('.modal-foot .btn-light')
  const p = (await store(page)).active.players[0]
  expect(p.tiers.Helmet).toBe('Uncommon')
  expect(p.inventory.filter((i: { slot: string }) => i.slot === 'Helmet').map((i: { name: string }) => i.name)).toEqual(['Daring Hunter Mask'])
  const tile = page.locator('.guardian').first().locator('.tile.item[aria-label^="Daring Hunter Mask"]')
  await expect(tile).toHaveClass(/r-uncommon/)
  await expect(tile).toHaveClass(/is-sim/)
})

test('a Directive can set simulated armor for everyone: no choice in the lobby', async ({ page }) => {
  await fresh(page)
  await page.click('text=Create lobby')
  await collapseTools(page)
  await page.click('.sidebar >> text=Directives')
  await page.locator('.proto', { hasText: 'Standard Directive' }).locator('button:has-text("Customize")').click()
  await page.fill('#sb-name', 'Sim Armor')
  await page.click('.sb-nav button:has-text("Gear progression")')
  await page.selectOption('#sb-sandbox-armorTiers', 'simulated')
  await page.click('button:has-text("Save Directive")')
  await page.locator('.proto', { hasText: 'Sim Armor' }).locator('button:has-text("Use in lobby")').click()
  await page.click('.sidebar >> text=Setup and rules')
  await expect(page.locator('.seat.is-you section[aria-label="Armor tiers"]')).toHaveCount(0)
  await expect(page.locator('.setup-guide')).toContainText('Armor is simulated')
})

test('final boss: a random aspect after the ability pick; not signed in, a slot tier-up in place of Exotic armor; Vault weapons locked until weapons are Legendary', async ({ page }) => {
  await fresh(page)
  await startRun(page)
  await tools(page, async () => { await toolsForMe(page); await page.click('.devtools button:has-text("Final boss")') })
  await expect.poll(async () => (await store(page)).active.pending.length).toBeGreaterThan(0)
  const pend = (await store(page)).active.pending[0]
  expect(pend.aspect).toContain('|aspect|')
  for (const id of pend.unlock) expect(id).not.toContain('|aspect|')
  expect(pend.exotic).toHaveLength(0)
  expect(pend.tierup).toHaveLength(3)
  expect(pend.legendary).toHaveLength(0)
  expect(pend.locks.legendary).toContain('0 of 3')
  expect(pend.artifact).toHaveLength(3)
  // Ability pick, then the aspect, then the gear: tier up the first slot offered.
  await page.click('.modal .choice >> nth=0')
  await page.click('.modal-foot .btn-light')
  await expect(page.locator('.modal h2')).toHaveText('Bonus aspect from the boss')
  await page.click('.modal-foot .btn-light')
  await page.click('.modal .choice:has-text("Gear tier-up")')
  const slot = pend.tierup[0] as string
  const before = (await store(page)).active.players[0].tiers[slot]
  await page.locator('.modal .choice', { hasText: slot }).first().click()
  await page.click('.modal-foot .btn-light')
  await page.click('.modal .choice >> nth=0')
  await page.click('.modal-foot .btn-light')
  await page.click('.modal-foot button:has-text("claim rewards")')
  await expect.poll(async () => (await store(page)).active.players[0].unlocked).toContain(pend.aspect)
  expect((await store(page)).active.players[0].tiers[slot]).not.toBe(before)
})

test('BONUS rolls on encounter clears only, not on a final boss', async ({ page }) => {
  await fresh(page)
  await startRun(page)
  // A certain BONUS, so whether it rolls depends only on where it can come from.
  await editStore(page, 's.active.ruleset.sandbox = { bonusChance: 100 }')
  await page.locator('.side-player .sp-main').click()
  await page.click('.modal-foot button:has-text("Record clear and advance")')
  await expect.poll(async () => (await store(page)).active.pending.map((x: { final: boolean; bonus?: boolean }) => `${x.final}:${!!x.bonus}`)).toEqual(['false:true'])
  await editStore(page, 's.active.pending = []; s.active.eIdx = 2; s.active.chestsDone = 9')
  await expect(page.locator('.side-player .sp-title')).toContainText('Dûl Incaru')
  await page.locator('.side-player .sp-main').click()
  await page.click('.modal-foot button:has-text("Record clear and advance")')
  await expect.poll(async () => (await store(page)).active.pending.map((x: { final: boolean; bonus?: boolean }) => `${x.final}:${!!x.bonus}`)).toEqual(['true:false'])
})

test('heavy weapon: green to blue takes two Legendary drops, then blue to Legendary takes one', async ({ page }) => {
  await fresh(page)
  await startRun(page)
  const me = async () => (await store(page)).active.players[0]
  expect((await me()).tiers.Power).toBe('Uncommon')
  const drop = () => tools(page, async () => { await toolsForMe(page); await page.selectOption('.devtools select[aria-label="Slot"]', 'Power'); await page.click('.devtools button:has-text("Add a drop")') })
  await drop()
  await expect(page.locator('.modal h2')).toHaveText('Power: 1 of 2 drops towards Rare')
  await expect(page.locator('.upgrade-steps li').first()).toContainText('Dismantle or vault')
  // A random green heavy weapon to use in place of the dismantled drop.
  await expect(page.locator('.upgrade-steps li').nth(1)).toContainText('Use ')
  await expect.poll(async () => (await me()).upgrades?.[0]?.item).toBeTruthy()
  const green = (await me()).upgrades[0].item as string
  const powers = async () => (await me()).inventory.filter((i: { slot: string }) => i.slot === 'Power').length
  const before = await powers()
  await page.click('.modal-foot .btn-light')
  await expect.poll(async () => (await me()).tierProgress?.Power).toBe(1)
  expect((await me()).tiers.Power).toBe('Uncommon')
  await expect.poll(powers).toBe(before + 1)
  expect((await me()).inventory.find((i: { name: string; slot: string }) => i.name === green && i.slot === 'Power')?.rarity).toBe('Uncommon')
  await expect(page.locator('.guardian').first().locator('.g-slot', { hasText: 'Power' }).locator('.tier-progress')).toHaveText('1/2')
  await drop()
  await expect(page.locator('.modal h2')).toHaveText('Power: Uncommon → Rare')
  await expect.poll(async () => (await me()).tiers.Power).toBe('Rare')
  expect((await me()).tierProgress?.Power).toBeUndefined()
})
