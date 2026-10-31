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
