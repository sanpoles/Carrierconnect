import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, request as playwrightRequest, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(currentDir, '../../..')

require(path.join(rootDir, 'backend/node_modules/dotenv')).config({
  path: path.join(rootDir, 'backend/.env'),
})

process.env.DB_NAME = 'careerconnect_qa'
process.env.NODE_ENV = process.env.NODE_ENV || 'test'

const { Pool } = require(path.join(rootDir, 'backend/node_modules/pg'))
const bcrypt = require(path.join(rootDir, 'backend/node_modules/bcryptjs'))
const jwt = require(path.join(rootDir, 'backend/node_modules/jsonwebtoken'))
const env = require(path.join(rootDir, 'backend/src/config/env'))

const apiBaseUrl = process.env.QA_API_URL || 'http://localhost:4000'

function createToken(user: Record<string, unknown>) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      adminScope: user.admin_scope,
      authVersion: user.auth_version,
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn },
  )
}

function pdfBuffer() {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')
}

function docxBuffer() {
  return Buffer.from('PK\u0003\u0004QA-only DOCX validation content')
}

async function addCompleteCareerProfile(pool: any, userId: string) {
  await pool.query(
    `INSERT INTO user_career_profiles(
      user_id,
      professional_summary,
      current_job_title,
      industry,
      years_of_experience,
      target_role,
      skills,
      career_goals,
      updated_at
    )
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [
      userId,
      'QA-only request readiness profile.',
      'Support Analyst',
      'Information Technology',
      2,
      'Cloud Operations Engineer',
      JSON.stringify(['support', 'cloud operations', 'documentation']),
      'Validate request readiness without real customer data.',
    ],
  )
}

async function createQaUser(pool: any, email: string, role = 'user') {
  const passwordHash = await bcrypt.hash('QaRequestReadyPassword123', 10)
  const result = await pool.query(
    `INSERT INTO users(full_name, email, password_hash, role, is_active)
     VALUES($1, $2, $3, $4, true)
     RETURNING id, full_name, email, role, admin_scope, auth_version`,
    [`QA ${role} ${email}`, email, passwordHash, role],
  )

  return result.rows[0]
}

test('resume replacement keeps exactly one current private resume and preserves access rules', async () => {
  const pool = new Pool(env.database)
  const api = await playwrightRequest.newContext({ baseURL: apiBaseUrl })
  const runId = `${Date.now()}-${randomUUID()}`

  try {
    const database = await pool.query('SELECT current_database() AS database_name')
    expect(database.rows[0].database_name).toBe('careerconnect_qa')

    const user = await createQaUser(pool, `qa.resume.replace.${runId}@careerconnect.test`)
    const otherUser = await createQaUser(pool, `qa.resume.other.${runId}@careerconnect.test`)
    const unassignedCounsellor = await createQaUser(
      pool,
      `qa.resume.unassigned.${runId}@careerconnect.test`,
      'counsellor',
    )

    await addCompleteCareerProfile(pool, user.id)
    await addCompleteCareerProfile(pool, otherUser.id)
    await pool.query(
      `INSERT INTO counsellor_profiles(
        user_id,
        headline,
        biography,
        years_of_experience,
        specializations,
        languages,
        is_available,
        created_at,
        updated_at
      )
      VALUES($1,$2,$3,$4,$5,$6,true,NOW(),NOW())`,
      [
        unassignedCounsellor.id,
        'QA Unassigned Counsellor',
        'QA-only counsellor profile.',
        3,
        JSON.stringify(['Career guidance']),
        JSON.stringify(['English']),
      ],
    )

    const seededCounsellor = await pool.query(
      `SELECT id, full_name, email, role, admin_scope, auth_version
       FROM users
       WHERE email = 'qa.counsellor@careerconnect.test'`,
    )
    const operationalAdmin = await pool.query(
      `SELECT id, full_name, email, role, admin_scope, auth_version
       FROM users
       WHERE email = 'qa.operational.admin@careerconnect.test'`,
    )

    const userToken = createToken(user)
    const otherUserToken = createToken(otherUser)
    const assignedCounsellorToken = createToken(seededCounsellor.rows[0])
    const unassignedCounsellorToken = createToken(unassignedCounsellor)
    const operationalAdminToken = createToken(operationalAdmin.rows[0])

    async function uploadResume(name: string, mimeType: string, buffer: Buffer) {
      return api.post('/api/me/career-profile/resume', {
        headers: { Authorization: `Bearer ${userToken}` },
        multipart: {
          resume: {
            name,
            mimeType,
            buffer,
          },
        },
      })
    }

    async function expectCurrentResume(expectedId: string, replacedIds: string[] = []) {
      const result = await pool.query(
        `SELECT id, is_current, replaced_by_document_id
         FROM user_resume_documents
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY uploaded_at ASC`,
        [user.id],
      )
      const current = result.rows.filter((row: { is_current: boolean }) => row.is_current)

      expect(current).toHaveLength(1)
      expect(current[0].id).toBe(expectedId)

      for (const replacedId of replacedIds) {
        const replaced = result.rows.find((row: { id: string }) => row.id === replacedId)
        expect(replaced?.is_current).toBe(false)
        expect(replaced?.replaced_by_document_id).toBeTruthy()
      }
    }

    const firstPdf = await uploadResume('qa-first.pdf', 'application/pdf', pdfBuffer())
    expect(firstPdf.status()).toBe(201)
    const firstPdfBody = await firstPdf.json()
    const firstPdfId = firstPdfBody.resume.id
    await expectCurrentResume(firstPdfId)

    const badReplacement = await uploadResume('qa-invalid.pdf', 'application/pdf', Buffer.from('not a pdf'))
    expect(badReplacement.status()).toBe(400)
    await expectCurrentResume(firstPdfId)

    const replacementDocx = await uploadResume(
      'qa-replacement.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      docxBuffer(),
    )
    expect(replacementDocx.status()).toBe(201)
    const replacementDocxBody = await replacementDocx.json()
    const replacementDocxId = replacementDocxBody.resume.id
    await expectCurrentResume(replacementDocxId, [firstPdfId])

    const replacementPdf = await uploadResume('qa-replacement.pdf', 'application/pdf', pdfBuffer())
    expect(replacementPdf.status()).toBe(201)
    const replacementPdfBody = await replacementPdf.json()
    const replacementPdfId = replacementPdfBody.resume.id
    await expectCurrentResume(replacementPdfId, [firstPdfId, replacementDocxId])

    const contact = await api.put('/api/me/service-contact', {
      headers: { Authorization: `Bearer ${userToken}` },
      data: {
        phoneCountryCode: '+1',
        phoneNumber: '5550107777',
        serviceCommunicationConsent: true,
      },
    })
    expect(contact.status()).toBe(200)

    const createdRequest = await api.post('/api/requests', {
      headers: { Authorization: `Bearer ${userToken}` },
      data: {
        requestType: 'mock_interview',
        title: 'QA current resume request',
        description: 'QA-only request should use the current replacement resume.',
      },
    })
    expect(createdRequest.status()).toBe(201)
    const createdRequestBody = await createdRequest.json()
    const requestId = createdRequestBody.request.id

    const requestMetadata = await pool.query(
      `SELECT resume_document_id
       FROM service_requests
       WHERE id = $1`,
      [requestId],
    )
    expect(requestMetadata.rows[0].resume_document_id).toBe(replacementPdfId)

    await pool.query(
      `UPDATE service_requests
       SET assigned_counsellor_id = $1
       WHERE id = $2`,
      [seededCounsellor.rows[0].id, requestId],
    )

    const ownerDownload = await api.get(`/api/resumes/${replacementPdfId}/download`, {
      headers: { Authorization: `Bearer ${userToken}` },
    })
    expect(ownerDownload.status()).toBe(200)

    const otherUserDownload = await api.get(`/api/resumes/${replacementPdfId}/download`, {
      headers: { Authorization: `Bearer ${otherUserToken}` },
    })
    expect([403, 404]).toContain(otherUserDownload.status())

    const assignedPreparation = await api.get(`/api/counsellor/requests/${requestId}/preparation`, {
      headers: { Authorization: `Bearer ${assignedCounsellorToken}` },
    })
    expect(assignedPreparation.status()).toBe(200)

    const unassignedPreparation = await api.get(`/api/counsellor/requests/${requestId}/preparation`, {
      headers: { Authorization: `Bearer ${unassignedCounsellorToken}` },
    })
    expect([403, 404]).toContain(unassignedPreparation.status())

    const adminRequest = await api.get(`/api/admin/requests/${requestId}`, {
      headers: { Authorization: `Bearer ${operationalAdminToken}` },
    })
    expect(adminRequest.status()).toBe(200)
    const adminRequestBody = await adminRequest.json()
    expect(adminRequestBody.request.resumeDocument.id).toBe(replacementPdfId)
  } finally {
    await api.dispose()
    await pool.end()
  }
})
