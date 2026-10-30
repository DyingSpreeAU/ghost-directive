import { test, expect, exampleRun, tools, toolsForMe, later, store } from './helpers'

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
  await expect(page.locator('.guardian').first().locator('.g-slot').first().locator('.g-slot-head')).toContainText('Uncommon')
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
