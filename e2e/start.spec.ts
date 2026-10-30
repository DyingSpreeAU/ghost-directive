import { test, expect, fresh } from './helpers'

test.describe('start screen', () => {
  test('shows hosting, joining and the explainer link', async ({ page }) => {
    await fresh(page)
    await expect(page.getByRole('button', { name: 'Create lobby' })).toBeVisible()
    await expect(page.getByText('The run itself lives in the host’s browser.')).toBeVisible()
    await page.fill('#join-code', 'abc')
    await page.click('button:has-text("Join")')
    await expect(page.getByText('Lobby codes are 6 letters and numbers')).toBeVisible()
  })

  test('How it works opens the explainer and closes back to the start screen', async ({ page }) => {
    await fresh(page)
    await page.click('text=How it works')
    await expect(page.locator('.xp-sec').first()).toBeVisible()
    await page.locator('.xp-end').scrollIntoViewIfNeeded()
    await page.click('text=Back to the start screen')
    await expect(page.locator('.xp-sec')).toHaveCount(0)
  })
})

test.describe('first visit', () => {
  test.use({ showIntro: true })
  test('plays the explainer as an intro once', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.locator('.xp-sec').first()).toBeVisible()
    await page.click('text=Skip intro')
    await page.reload()
    await expect(page.locator('.xp-sec')).toHaveCount(0)
  })
})

test('Integrity gauge: the arc always settles on the number, drains to zero and loops', async ({ page }) => {
  test.setTimeout(90_000)
  await fresh(page)
  await page.click('text=How it works')
  await page.locator('.xp-int').scrollIntoViewIfNeeded()
  const read = () => page.evaluate(() => ({
    n: document.querySelector('.xp-count')?.textContent ?? null,
    arc: Math.round(100 - parseFloat(getComputedStyle(document.querySelector('.xp-gauge')!).strokeDashoffset)),
    over: !!document.querySelector('.xp-runover'),
  }))
  let settled = 0, sawOver = false, sawRestart = false
  for (let k = 0; k < 120 && !(sawOver && sawRestart); k++) {
    const s = await read()
    if (s.over) sawOver = true
    else if (sawOver && s.n === '50') sawRestart = true
    // A value that holds for two reads is settled: arc and number must agree (Standard max is 100).
    const again = await (async () => { await page.waitForTimeout(150); return read() })()
    if (!s.over && s.n === again.n && s.arc === again.arc) { expect(Number(s.n)).toBe(s.arc); settled++ }
    await page.waitForTimeout(100)
  }
  expect(settled).toBeGreaterThan(5)
  expect(sawOver, 'reaches Run over').toBe(true)
  expect(sawRestart, 'loops back to 50').toBe(true)
})
