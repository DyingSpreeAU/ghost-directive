// Every main screen at phone, tablet, laptop, desktop and ultrawide sizes: nothing overlapping,
// spilling out of its box or running off the side.
import { test, expect, fresh, exampleRun, collapseTools, tools, toolsForMe, later, sweep } from './helpers'

test.describe.configure({ mode: 'parallel' })
test.setTimeout(240_000)

test('start screen and explainer @layout', async ({ page }) => {
  await fresh(page)
  expect(await sweep(page)).toEqual([])
  await page.click('text=How it works')
  const n = await page.locator('.xp-sec').count()
  for (let i = 0; i < n; i++) expect(await sweep(page, () => page.locator('.xp-sec').nth(i).scrollIntoViewIfNeeded()), `explainer section ${i + 1}`).toEqual([])
})

test('lobby @layout', async ({ page }) => {
  await fresh(page)
  await page.click('text=Create lobby')
  await collapseTools(page)
  expect(await sweep(page, () => page.evaluate(() => scrollTo(0, 0)))).toEqual([])
  expect(await sweep(page, () => page.locator('#seats').scrollIntoViewIfNeeded())).toEqual([])
  await page.locator('#route .seg button:has-text("Custom")').click()
  expect(await sweep(page, () => page.locator('#route').scrollIntoViewIfNeeded())).toEqual([])
})

test('Directives and the sandbox editor @layout', async ({ page }) => {
  await fresh(page)
  await page.click('text=Create lobby')
  await collapseTools(page)
  await page.click('.sidebar >> text=Directives')
  expect(await sweep(page)).toEqual([])
  await page.locator('.proto', { hasText: 'Standard Directive' }).locator('button:has-text("Customize")').click()
  for (const s of ['Integrity', 'Starting setup', 'Gear progression', 'Inventory', 'Rewards']) {
    await page.click(`.sb-nav button:has-text("${s}")`)
    expect(await sweep(page, () => page.locator('.sandbox').scrollIntoViewIfNeeded()), s).toEqual([])
  }
})

test('run screens @layout', async ({ page }) => {
  await exampleRun(page)
  expect(await sweep(page, () => page.evaluate(() => scrollTo(0, 0)))).toEqual([])
  expect(await sweep(page, () => page.locator('.guardian').first().scrollIntoViewIfNeeded())).toEqual([])
  expect(await sweep(page, () => page.locator('.ab-kinds').first().scrollIntoViewIfNeeded())).toEqual([])
  expect(await sweep(page, () => page.evaluate(() => scrollTo(0, document.body.scrollHeight)))).toEqual([])
})

test('pop-ups @layout', async ({ page }) => {
  await exampleRun(page)
  await page.click('.command button:has-text("Record Wipe")')
  expect(await sweep(page), 'wipe').toEqual([])
  await page.keyboard.press('Escape')
  await tools(page, async () => { await toolsForMe(page); await page.click('.devtools button:has-text("Final boss")') })
  expect(await sweep(page), 'final boss reward').toEqual([])
  await page.keyboard.press('Escape'); await later(page)
  await page.click('.sidebar .bug-link')
  expect(await sweep(page), 'bug report').toEqual([])
})
