import { expect, test } from '@playwright/test'
import { clearBrowserSession } from '../fixtures/auth'

test.beforeEach(async ({ page }) => {
  await clearBrowserSession(page)
})

test('public home page loads', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: /Take the next step/i }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: /Get personalised support/i }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Create free account/i }),
  ).toBeVisible()
})

test('protected route redirects correctly when not authenticated', async ({ page }) => {
  await page.goto('/app/dashboard')

  await expect(page).toHaveURL(/\/login$/)
  await expect(
    page.getByRole('heading', { name: /Log in to CareerConnect/i }),
  ).toBeVisible()
})
