import { expect, test } from '@playwright/test'
import {
  clearBrowserSession,
  loginViaUi,
  qaAccounts,
} from '../fixtures/auth'

test.beforeEach(async ({ page }) => {
  await clearBrowserSession(page)
})

test('operational admin is denied Platform Owner-only user management access', async ({ page }) => {
  await loginViaUi(page, qaAccounts.operationalAdmin)

  await expect(page).toHaveURL(/\/admin\/overview$/)
  await expect(
    page.getByRole('heading', {
      name: /Run request operations with clear, matching filters/i,
    }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0)

  const apiStatus = await page.evaluate(async () => {
    const token = window.localStorage.getItem('careerconnect_token')
    const response = await fetch('http://localhost:4000/api/admin/users', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })

    return response.status
  })

  expect(apiStatus).toBe(403)
})

test('platform owner can access user management screen', async ({ page }) => {
  await loginViaUi(page, qaAccounts.platformOwner)

  await expect(page).toHaveURL(/\/admin\/overview$/)
  await expect(
    page.getByRole('heading', {
      name: /Run request operations with clear, matching filters/i,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Users' }).click()

  await expect(
    page.getByRole('heading', {
      name: /Manage access without exposing platform ownership controls/i,
    }),
  ).toBeVisible()
  await expect(page.getByText('IDENTITY & ACCESS')).toBeVisible()
  const usersTable = page.getByRole('table')
  await expect(
    usersTable.getByText(qaAccounts.platformOwner.email, { exact: true }),
  ).toBeVisible()
})
