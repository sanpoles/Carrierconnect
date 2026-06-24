import { randomUUID } from 'node:crypto'
import { expect, type Page } from '@playwright/test'

export type QaRole = 'user' | 'counsellor' | 'operationalAdmin' | 'platformOwner'

export type QaAccount = {
  fullName: string
  email: string
  password: string
}

export const QA_MARKER = 'CAREERCONNECT_QA_E2E'

export const qaAccounts: Record<QaRole, QaAccount> = {
  user: {
    fullName: 'QA Career User',
    email: 'qa.user@careerconnect.test',
    password: 'QaUserPassword123',
  },
  counsellor: {
    fullName: 'QA Career Counsellor',
    email: 'qa.counsellor@careerconnect.test',
    password: 'QaCounsellorPassword123',
  },
  operationalAdmin: {
    fullName: 'QA Operational Admin',
    email: 'qa.operational.admin@careerconnect.test',
    password: 'QaOpsAdminPassword123',
  },
  platformOwner: {
    fullName: 'QA Platform Owner',
    email: 'qa.platform.owner@careerconnect.test',
    password: 'QaOwnerPassword123',
  },
}

export function smokeRegistrationAccount() {
  const runId = `${Date.now()}-${randomUUID()}`

  return {
    fullName: `QA Smoke User ${runId}`,
    email: `qa.smoke.user.${runId}@careerconnect.test`,
    password: 'QaSmokeUserPassword123',
  }
}

export async function clearBrowserSession(page: Page) {
  await page.context().clearCookies()
  await page.addInitScript(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
}

export async function loginViaUi(page: Page, account: QaAccount) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: /^Login\b/ }).click()
}

export async function logoutViaUi(page: Page) {
  await page.getByRole('button', { name: /Logout/ }).click()
  await expect(page).toHaveURL('/')
}
