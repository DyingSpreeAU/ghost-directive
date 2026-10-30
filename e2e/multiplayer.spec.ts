// Host and guest on separate browsers through the local lobby server.
import { test, expect, fresh, stubBungie, account, item, I, B, HUNTER, collapseTools } from './helpers'

test('guest joins, readies up, and on a reopened run can only restore', async ({ browser, baseURL }) => {
  test.setTimeout(180_000)
  const host = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await host.addInitScript(() => localStorage.setItem('ghost-directive:seen-intro', '1'))
  await fresh(host)
  await host.click('text=Create lobby')
  const code = (await host.textContent('.code-big'))!.trim()
  await host.waitForSelector('.net-online', { timeout: 30_000 })

  const a = account()
  const guest = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await guest.addInitScript(() => localStorage.setItem('ghost-directive:seen-intro', '1'))
  await stubBungie(guest, a, baseURL!, '43')
  await guest.goto('/')
  await guest.evaluate(() => localStorage.setItem('ghost-directive:bungie-tokens', JSON.stringify({ access: 'AT', accessExp: Date.now() + 3600e3, refresh: 'RT', refreshExp: Date.now() + 9e8, membershipId: '43' })))
  await guest.reload()
  await guest.fill('#join-code', code)
  await guest.click('button:has-text("Join")')
  await guest.click('text=Join as a new Guardian', { timeout: 30_000 })
  await collapseTools(guest)
  await guest.click('.seat.is-you .art-pick [role=radio][title^="Tablet of Ruin"]')
  await guest.click('text=I’m ready')
  await collapseTools(host)
  await host.click('.seat.is-you .art-pick [role=radio][title^="Encrypted Data Disk"]')
  await expect(host.locator('.seat-status.st-ready')).toHaveCount(2)
  await host.click('text=Begin run and lock route')
  await expect(guest.locator('#arsenal')).toBeVisible()

  await host.click('.sidebar >> text=Back to start screen')
  a.chars[HUNTER].inv.push(item(a, I.StayAway, B.e))
  await host.click('.saved-run button:has-text("Resume")')
  await expect(guest.locator('.resume-lobby')).toBeVisible({ timeout: 30_000 })
  await collapseTools(guest)
  // Besides showing or hiding the guide and copying the lobby code, a guest's only button is Restore.
  const clickable = await guest.locator('.resume-lobby :is(button, input, select):not([disabled]):not(.code-copy)').allTextContents()
  expect(clickable.map((t) => t.trim()).filter((t) => t !== 'Hide' && t !== 'Show')).toEqual(['Restore my Guardian'])
  a.location = false
  await guest.click('.resume-lobby button:has-text("Restore my Guardian")')
  await guest.click('.modal-foot button:has-text("Restore")')
  await expect(host.locator('.seat-status', { hasText: 'Restored' })).toHaveCount(1)
})

test('a guest records a clear, a wipe and another Guardian’s death', async ({ browser }) => {
  test.setTimeout(180_000)
  const open = async () => {
    const pg = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
    await pg.addInitScript(() => localStorage.setItem('ghost-directive:seen-intro', '1'))
    return pg
  }
  const host = await open()
  await fresh(host)
  await host.click('text=Create lobby')
  const code = (await host.textContent('.code-big'))!.trim()
  await host.waitForSelector('.net-online', { timeout: 30_000 })
  const guest = await open()
  await guest.goto('/')
  await guest.fill('#join-code', code)
  await guest.click('button:has-text("Join")')
  await guest.click('text=Join as a new Guardian', { timeout: 30_000 })
  await collapseTools(guest)
  await guest.click('.seat.is-you .art-pick [role=radio][title^="Tablet of Ruin"]')
  await guest.click('text=I’m ready')
  await collapseTools(host)
  await host.click('.seat.is-you .art-pick [role=radio][title^="Encrypted Data Disk"]')
  await expect(host.locator('.seat-status.st-ready')).toHaveCount(2)
  await host.click('text=Begin run and lock route')
  await expect(guest.locator('#arsenal')).toBeVisible()

  const sp = guest.locator('.side-player')
  // The host's death, recorded from the guest's screen.
  const hostCol = guest.locator('.guardian', { has: guest.locator('.tag-host') })
  await hostCol.locator('button:has-text("Record death")').click()
  await expect(host.locator('.guardian.is-you .death-count strong')).toHaveText('1')
  // Both record the same wipe: the host's screen is open first, the guest's lands first.
  const before = (await host.textContent('.int-value .num'))!
  await host.locator('.side-player button[aria-label="Record wipe"]').click()
  await sp.locator('button[aria-label="Record wipe"]').click()
  await guest.click('.modal-foot .btn-danger')
  await expect(host.locator('.int-value .num')).not.toHaveText(before)
  const after = (await host.textContent('.int-value .num'))!
  await host.click('.modal-foot .btn-danger')
  await expect(host.locator('.toast')).toHaveText('Someone else just recorded this wipe.')
  await expect(host.locator('.int-value .num')).toHaveText(after)
  // The guest clears the encounter; the host's player moves on.
  await sp.locator('.sp-main').click()
  await guest.click('.modal-foot button:has-text("Record clear and advance")')
  await expect(host.locator('.side-player .sp-title')).toHaveText('Vorgeth, The Boundless Hunger')
  await expect(host.locator('#report')).toContainText('Recorded by')
})
