import { test, expect } from '@playwright/test'

// Always a future Monday, so business-hours/date-in-the-future validation
// passes no matter what day the test suite happens to run on.
function nextMonday() {
  const d = new Date()
  const diff = ((8 - d.getDay()) % 7) || 7
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

test('a visitor can book a real appointment end to end', async ({ page }) => {
  // The booking flow's own two API calls are mocked here — everything else
  // (Firestore via the emulator, the real UI, real validation) stays real.
  await page.route('**/api/verify-captcha', (route) => route.fulfill({ json: { ok: true } }))
  await page.route('**/api/notify-booking', (route) => route.fulfill({ json: {} }))

  await page.goto('/')
  await page.getByRole('button', { name: 'Book an appointment' }).click()

  await page.getByLabel('Cleanings', { exact: false }).check()
  await page.getByLabel('Date').fill(nextMonday())
  await page.getByLabel('Start time').selectOption('480')
  await page.getByLabel('Name').fill('Playwright Test Patient')
  await page.getByLabel('Email').fill('playwright-test@example.com')
  await page.getByLabel('Phone').fill('555-0100')

  const hcaptchaFrame = page.frameLocator(
    'iframe[title="Widget containing checkbox for hCaptcha security challenge"]'
  )
  await hcaptchaFrame.getByRole('checkbox').click()
  // The click starts verification — wait for it to actually finish and call
  // BookingModal's onVerify before submitting, or captchaToken is still empty.
  await expect(hcaptchaFrame.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')

  await page.getByRole('button', { name: 'Confirm booking' }).click()

  await expect(page.getByText("You're booked!")).toBeVisible()
  await expect(page.getByText(/BHD-\d{6}/)).toBeVisible()
})
