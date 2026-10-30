import { test, expect, exampleRun, tools, toolsForMe, later, editStore } from './helpers'

async function fourLegendaries(page: import('@playwright/test').Page, n = 4) {
  await tools(page, async () => {
    await toolsForMe(page)
    await page.click('.devtools button:has-text("All slots Legendary")')
    await page.click('.devtools button:has-text("Empty inventory")')
    for (let k = 0; k < n; k++) { await page.click('.devtools button:has-text("Add a drop")'); await page.waitForTimeout(120) }
  })
}

test('trade-up: inputs are given up, options are fixed even after a reload, and one is kept', async ({ page }) => {
  await exampleRun(page)
  await fourLegendaries(page)
  const slot = page.locator('.guardian').first().locator('.g-slot').first()
  await slot.locator('button:has-text("Trade up")').click()
  const inputs = page.locator('.modal .choice.trade-in:not([disabled])')
  for (let k = 0; k < 4; k++) await inputs.nth(k).click()
  await page.click('.modal-foot .btn-light')
  await expect(page.locator('.modal h2')).toContainText('Choose 1 of')
  const options = await page.locator('.modal .choice-item strong').allTextContents()
  await page.keyboard.press('Escape')
  await expect(page.locator('.modal .choice-item').first()).toBeVisible()
  await page.reload()
  await expect(page.locator('.modal .choice-item strong')).toHaveText(options)
  await page.locator('.modal .choice-item').first().click()
  await page.click('.modal-foot .btn-light')
  await later(page)
  await expect(slot.locator('.tile.item')).toHaveCount(1)
})

test('room rule: an over-full slot can’t trade up until an Arsenal Expansion', async ({ page }) => {
  await exampleRun(page)
  await editStore(page, "s.active.ruleset.inventory.capacity = 3; s.active.ruleset.tradeUp.inputs = 4; s.active.ruleset.sandbox = { tradeUpNeedsRoom: true }")
  await later(page)
  await fourLegendaries(page)
  await expect(page.locator('.modal h2')).toContainText('over capacity')
  await expect(page.locator('.modal .choice').first()).toBeDisabled()
  await expect(page.locator('.modal .choice').first()).toContainText('Trade-ups need room for 4 items')
  await page.keyboard.press('Escape')
  await later(page)
  const slot = page.locator('.guardian').first().locator('.g-slot').first()
  await expect(slot.locator('button:has-text("Trade up")')).toHaveCount(0)
  await tools(page, () => page.click('.devtools button:has-text("Expansion +1")'))
  for (let k = 0; k < 4 && await page.locator('.scrim').count(); k++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150) }
  await expect(slot.locator('button:has-text("Trade up")')).toHaveCount(1)
})
