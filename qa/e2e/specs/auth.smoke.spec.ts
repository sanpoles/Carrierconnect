import { expect, test } from '@playwright/test'
import {
  clearBrowserSession,
  logoutViaUi,
  smokeRegistrationAccount,
} from '../fixtures/auth'

test.beforeEach(async ({ page }) => {
  await clearBrowserSession(page)
})

test('user registration, login, and logout work for a QA account', async ({ page }) => {
  const account = smokeRegistrationAccount()

  await page.goto('/register')
  await page.getByLabel('Full name').fill(account.fullName)
  await page.getByLabel('Email address').fill(account.email)
  await page.getByLabel('Phone number').fill('+15550101010')
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: /Create free account/i }).click()

  await expect(page).toHaveURL(/\/app\/dashboard$/)
  await expect(page.getByText(account.email)).toBeVisible()

  await logoutViaUi(page)

  await page.goto('/login')
  await page.getByLabel('Email address').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: /^Login\b/ }).click()

  await expect(page).toHaveURL(/\/app\/dashboard$/)
  await expect(page.getByText(account.email)).toBeVisible()

  await logoutViaUi(page)
})
