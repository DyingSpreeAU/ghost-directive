import { test, expect, exampleRun, tools, toolsForMe, later, store, fresh, collapseTools, editStore, pickArmor } from './helpers'

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
