import { test, expect, fresh, collapseTools, later, pickArmor } from './helpers'

test('host lobby: code card, copy, artifact gate, begin', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await fresh(page)
  await page.click('text=Create lobby')
  await collapseTools(page)
  const code = (await page.textContent('.code-big'))!.trim()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)
  await page.bringToFront()
  await page.click('.code-copy')
  await expect(page.locator('.toast')).toHaveText('Code copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code)
  await expect(page.getByText('Every Guardian needs an artifact')).toBeVisible()
  await expect(page.locator('.begin-bar .btn-light')).toBeDisabled()
  await page.click('.seat.is-you .art-pick [role=radio][title^="Tablet of Ruin"]')
  await pickArmor(page)
  await page.click('button:has-text("Begin run")')
  await expect(page.locator('.command')).toBeVisible()
  await later(page)
  // The code card sits in the same spot on the run page.
  await expect(page.locator('.code-big')).toHaveText(code)
})

test('custom route: drag tiles and the skip box', async ({ page }) => {
  await fresh(page)
  await page.click('text=Create lobby')
  await collapseTools(page)
  await page.locator('#route .seg button:has-text("Custom")').click()
  await expect(page.getByText('Drag the dungeons into the order you’ll run them.')).toBeVisible()
  await expect(page.getByText('Every dungeon is in the route. Drag one here to skip it.')).toBeVisible()
})

test('rules text follows the chosen Directive', async ({ page }) => {
  await fresh(page)
  await page.click('text=Create lobby')
  await collapseTools(page)
  await page.selectOption('#lobby-protocol', { label: 'Iron Directive' })
  await expect(page.locator('.rules-list')).toContainText('You start with 40')
  await expect(page.locator('.rules-list')).toContainText('−20')
})

test('easter egg: a Guardian named Zorpalod sees the owl in place of every image, until renamed', async ({ page }) => {
  await fresh(page)
  await page.click('text=Create lobby')
  await collapseTools(page)
  const name = page.locator('.seat.is-you .seat-name')
  const imgs = page.locator('.seat.is-you .art-pick img')
  const first = await imgs.first().getAttribute('src')
  expect(first).not.toContain('zorpalod')
  await name.fill(' zorpalod ')
  await name.press('Enter')
  await expect(imgs.first()).toHaveAttribute('src', '/easter/zorpalod.webp')
  const srcs = await page.locator('img').evaluateAll((els) => els.map((e) => e.getAttribute('src')))
  expect(srcs.every((s) => s === '/easter/zorpalod.webp')).toBe(true)
  await name.fill('Guardian 1')
  await name.press('Enter')
  await expect(imgs.first()).toHaveAttribute('src', first!)
})

test('a lobby on an older copy of its Directive (from before gear progression) uses the current one', async ({ page }) => {
  await fresh(page)
  await page.click('text=Create lobby')
  await collapseTools(page)
  await expect(page.locator('.seat.is-you section[aria-label="Armor tiers"]')).toBeVisible()
  // As saved by an older version: no gear progression, no newer sandbox rules.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('ghost-directive:v2')!)
    delete s.lobby.ruleset.progression; delete s.lobby.ruleset.sandbox
    localStorage.setItem('ghost-directive:v2', JSON.stringify(s))
  })
  await page.reload()
  await expect(page.locator('.seat.is-you section[aria-label="Armor tiers"]')).toBeVisible()
})

test('reopening the lobby after a run from before gear progression brings it in', async ({ page }) => {
  await fresh(page)
  await page.click('text=Create lobby')
  await collapseTools(page)
  await page.click('.seat.is-you .art-pick [role=radio][title^="Tablet of Ruin"]')
  await pickArmor(page)
  await page.click('button:has-text("Begin run")')
  await page.waitForSelector('#arsenal')
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('ghost-directive:v2')!)
    delete s.active.ruleset.progression; delete s.active.ruleset.sandbox; s.active.pending = []
    localStorage.setItem('ghost-directive:v2', JSON.stringify(s))
  })
  await page.reload()
  await page.click('.page-head button:has-text("End run")')
  await page.click('.modal-foot .btn-danger')
  await page.click('button:has-text("Archive and reopen lobby")')
  await expect(page.locator('.seat.is-you section[aria-label="Armor tiers"]')).toBeVisible()
})
