import { test, expect, exampleRun, editStore, startRun, fresh, layoutProblems } from './helpers'

test('wipe and death change Integrity', async ({ page }) => {
  await exampleRun(page)
  const before = Number(await page.textContent('.int-value .num'))
  await page.locator('.guardian').first().locator('button:has-text("Record my death")').click()
  await expect(page.locator('.int-value .num')).toHaveText(String(before - 5))
  await page.click('.command button:has-text("Record Wipe")')
  await page.click('.modal-foot .btn-danger')
  await expect(page.locator('.int-value .num')).toHaveText('0')
})

test('host mini bar appears once the panel scrolls off, and works', async ({ page }) => {
  await exampleRun(page)
  const bar = page.locator('.mini-command')
  await expect(bar).not.toHaveClass(/is-on/)
  await page.locator('.guardian').first().scrollIntoViewIfNeeded()
  await expect(bar).toHaveClass(/is-on/)
  await bar.locator('button:has-text("Record wipe")').click()
  await expect(page.locator('.modal h2')).toHaveText('Record team wipe')
  await page.keyboard.press('Escape')
  await bar.locator('.mini-int').click()
  await expect(bar).not.toHaveClass(/is-on/)
})

test('pop-ups draw above everything on the page', async ({ page }) => {
  await exampleRun(page)
  await page.click('.sidebar .bug-link')
  await page.waitForSelector('.bug-form')
  const covered = await page.evaluate(() => {
    const m = document.querySelector('.modal')!.getBoundingClientRect(), bad: string[] = []
    for (let x = m.left + 10; x < m.right - 10; x += 24) for (let y = m.top + 10; y < m.bottom - 10; y += 24) { const el = document.elementFromPoint(x, y); if (el && !el.closest('.modal')) bad.push(el.className.toString()) }
    return bad
  })
  expect(covered).toEqual([])
})

test('final boss bonus Integrity is added on the clear', async ({ page }) => {
  await fresh(page)
  await startRun(page)
  await editStore(page, "s.active.ruleset.sandbox = { finalClear: 15, secretChests: false }; s.active.eIdx = 2")
  await expect(page.locator('.enc-name')).toContainText('Final boss')
  await page.click('.command .progress-btn')
  await expect(page.locator('.modal')).toContainText('50 → 70')
  await page.click('.modal-foot button:has-text("Record clear")')
  await expect(page.locator('.int-value .num')).toHaveText('70')
})

test('reopening a run shows the read-only resume lobby', async ({ page }) => {
  await fresh(page)
  await startRun(page)
  await page.click('.sidebar >> text=Back to start screen')
  await page.click('.saved-run button:has-text("Resume")')
  await expect(page.locator('.resume-lobby')).toBeVisible()
  await expect(page.locator('.resume-lobby .seat input, .resume-lobby .seat [role=radio]:not([disabled])')).toHaveCount(0)
  await page.click('.resume-guide button:has-text("Hide")')
  await page.click('.sidebar >> text=Back to start screen')
  await page.click('.saved-run button:has-text("Resume")')
  await expect(page.locator('.resume-guide')).toHaveClass(/is-hidden/)
  await page.click('[aria-label="Collapse test tools"]').catch(() => {})
  await page.click('.resume-lobby button:has-text("Mark restored")')
  await expect(page.locator('.command')).toBeVisible()
  expect(await layoutProblems(page)).toEqual([])
})

test('the equipped item sits first in its slot, a size up, with no border or dot', async ({ page }) => {
  await exampleRun(page)
  await editStore(page, "const p = s.active.players[0]; p.inventory = p.inventory.filter((i) => i.slot !== 'Kinetic'); ['Pariah', 'Hung Jury SR4', 'Fatebringer'].forEach((n, k) => p.inventory.push({ id: 'k' + k, name: n, slot: 'Kinetic', rarity: 'Legendary', source: 'test', equipped: k === 2 }))")
  await page.waitForSelector('.guardian')
  const tiles = page.locator('.guardian').first().locator('.g-slot').first().locator('.tile')
  const boxes = await tiles.evaluateAll((t) => t.map((x) => ({ title: x.getAttribute('title'), w: x.getBoundingClientRect().width, left: x.getBoundingClientRect().left, shadow: getComputedStyle(x).boxShadow })))
  const first = boxes.reduce((a, b) => (b.left < a.left ? b : a))
  expect(first.title).toContain('Fatebringer')
  expect(first.title).toContain('Equipped')
  expect(first.w).toBeGreaterThan(boxes.find((b) => b !== first)!.w + 8)
  expect(first.shadow).toBe('none')
  await expect(page.locator('.tile-eq')).toHaveCount(0)
})

test('armor set pieces that share a name show their own slot’s icon', async ({ page }) => {
  await exampleRun(page)
  await editStore(page, "const p = s.active.players[0]; p.inventory = p.inventory.filter((i) => !['Helmet', 'Gauntlets', 'Chest'].includes(i.slot)); for (const slot of ['Helmet', 'Gauntlets', 'Chest']) p.inventory.push({ id: 'cd' + slot, name: 'Cry Defiance', slot, rarity: 'Uncommon', source: 'Uncommon tier', equipped: true })")
  await page.waitForSelector('.guardian')
  const col = page.locator('.guardian').first()
  const src = (slot: string) => col.locator('.g-slot', { has: page.locator('.g-slot-name', { hasText: new RegExp(`^${slot}$`) }) }).locator('.tile.item img').first().getAttribute('src')
  await expect(col.locator('.tile.item img[src*="bungie.net"]').first()).toBeVisible()
  const [helmet, gauntlets, chest] = await Promise.all([src('Helmet'), src('Gauntlets'), src('Chest')])
  expect(new Set([helmet, gauntlets, chest]).size).toBe(3)
})
