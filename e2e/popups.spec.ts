// Pop-ups and wizards that open by themselves must never replace one that's already open: a prompt
// that arrives meanwhile waits its turn. Test tools are clicked through the DOM while a pop-up covers them.
import { test, expect, fresh, startRun, editStore, store, toolsForMe } from './helpers'
import type { Page } from '@playwright/test'

const openTools = (page: Page) => page.click('[aria-label="Open test tools"]', { timeout: 1000 }).catch(() => {})
/** Clicks a test-tools button even while a pop-up covers the panel. */
const tool = (page: Page, label: string) => page.evaluate((l) => [...document.querySelectorAll<HTMLButtonElement>('.devtools button')].find((b) => b.textContent?.trim() === l)!.click(), label)
const title = (page: Page) => page.locator('.modal h2')

async function ready(page: Page) {
  await fresh(page)
  await startRun(page)
  // Weapons at Legendary, so the final boss's Vault weapon category is open.
  await editStore(page, "Object.assign(s.active.players[0].tiers, { Kinetic: 'Legendary', Energy: 'Legendary', Power: 'Legendary' })")
  await openTools(page)
  await toolsForMe(page)
}

test('a tier-up arriving mid-reward waits; the reward keeps its step and category, even after a reload', async ({ page }) => {
  await ready(page)
  await tool(page, 'Final boss')
  await page.click('.modal .choice >> nth=0')
  await page.click('.modal-foot .btn-light')
  await page.click('.modal .choice:has-text("Vault Legendary weapon")')
  await expect(title(page)).toHaveText('Choose 1 of 3 Vault weapons')
  // A Legendary helmet drop raises the Helmet slot: its tier-up screen must wait.
  await page.selectOption('.devtools select[aria-label="Slot"]', 'Helmet')
  await tool(page, 'Add a drop')
  await expect.poll(async () => (await store(page)).active.players[0].upgrades?.length ?? 0).toBe(1)
  await expect(title(page)).toHaveText('Choose 1 of 3 Vault weapons')
  // Closing and reopening (a reload) can't switch the category: it was saved with the reward.
  await page.reload()
  await page.click('.modal .choice >> nth=0')
  await page.click('.modal-foot .btn-light')
  await expect(title(page)).toHaveText('Choose 1 of 3 Vault weapons')
  await expect(page.locator('.modal .choice:has-text("Exotic armor")')).toHaveCount(0)
  // Finish the reward; then the waiting tier-up shows.
  await page.click('.modal .choice.choice-item >> nth=0')
  await page.click('.modal-foot .btn-light')
  await page.click('.modal-foot .btn-light')
  await page.click('.modal-foot button:has-text("claim rewards")')
  await expect(title(page)).toContainText('Helmet')
})

test('a reward arriving during a tier-up screen waits for it', async ({ page }) => {
  await ready(page)
  await page.selectOption('.devtools select[aria-label="Slot"]', 'Helmet')
  await tool(page, 'Add a drop')
  await expect(title(page)).toContainText('Helmet')
  await tool(page, 'Encounter')
  await expect.poll(async () => (await store(page)).active.pending.length).toBe(1)
  await expect(title(page)).toContainText('Helmet')
  await page.click('.modal-foot .btn-light')
  await expect(title(page)).toContainText('abilities')
})

test('the server can’t be told to switch a final-boss category once it’s picked', async ({ page }) => {
  await ready(page)
  await tool(page, 'Final boss')
  await page.click('.modal .choice >> nth=0')
  await page.click('.modal-foot .btn-light')
  await page.click('.modal .choice:has-text("Vault Legendary weapon")')
  await expect.poll(async () => (await store(page)).active.pending[0].cat).toBe('legendary')
  // Going Back to the ability step and forward again keeps the weapon category.
  await page.click('.modal-foot button:has-text("Back")')
  await page.click('.modal-foot .btn-light')
  await expect(title(page)).toHaveText('Choose 1 of 3 Vault weapons')
})
