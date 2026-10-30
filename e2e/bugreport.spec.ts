import { test, expect, exampleRun } from './helpers'

test('bug reports post every field, including version and Bungie status', async ({ page, baseURL }) => {
  let posted: URLSearchParams | null = null
  await page.route(`${baseURL}/`, (r) => r.request().method() === 'POST' ? (posted = new URLSearchParams(r.request().postData() ?? ''), r.fulfill({ status: 200, body: 'ok' })) : r.continue())
  await exampleRun(page)
  await page.click('.sidebar .bug-link')
  await expect(page.locator('.modal-foot .btn-light')).toBeDisabled()
  await page.fill('.bug-form textarea >> nth=0', 'Test report')
  await page.click('.modal-foot .btn-light')
  await expect(page.getByText('Your report was sent')).toBeVisible()
  const p = posted as URLSearchParams | null
  expect(p?.get('form-name')).toBe('bug-report')
  expect(p?.get('what')).toBe('Test report')
  expect(p?.get('page')).toContain('run')
  expect(p?.get('version')).toMatch(/^\w+ \(\d{4}-\d\d-\d\d\)$/)
  expect(p?.get('bungie')).toBeTruthy()
})

test('without Netlify, the report is copied to the clipboard', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.route(`${baseURL}/`, (r) => r.request().method() === 'POST' ? r.fulfill({ status: 404, body: '' }) : r.continue())
  await exampleRun(page)
  await page.click('.sidebar .bug-link')
  await page.fill('.bug-form textarea >> nth=0', 'second')
  await page.click('.modal-foot .btn-light')
  await expect(page.getByText('copied to your clipboard')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('what: second')
})
