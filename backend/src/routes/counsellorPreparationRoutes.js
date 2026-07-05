const express = require("express");
const { z } = require("zod");

const { pool } = require("../db/pool");
const { authenticateToken, requireRoles } = require("../middleware/authMiddleware");
const { validateParams } = require("../middleware/validateParams");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
const requestIdParamsSchema = z
  .object({
    requestId: z.string().regex(/^[0-9a-f-]{36}$/i),
  })
  .strict();

router.use(authenticateToken);
router.use(requireRoles("counsellor", "admin"));

router.get(
  "/requests/:requestId/preparation",
  validateParams(requestIdParamsSchema),
  asyncHandler(async (req, res) => {
    const accessResult = await pool.query(
      `SELECT
        sr.user_id,
        sr.resume_document_id,
        sr.service_phone_e164,
        sr.service_contact_consent_at
       FROM service_requests sr
       WHERE sr.id=$1 AND ($2='admin' OR sr.assigned_counsellor_id=$3)`,
      [req.validatedParams.requestId, req.user.role, req.user.id]
    );

    if (!accessResult.rowCount) {
      return res
        .status(404)
        .json({ success: false, message: "Engagement not found or unavailable." });
    }

    const requestRecord = accessResult.rows[0];
    const [profileResult, resumeResult] = await Promise.all([
      pool.query("SELECT * FROM user_career_profiles WHERE user_id=$1", [
        requestRecord.user_id,
      ]),
      pool.query(
        `SELECT id, original_file_name, mime_type, size_bytes, uploaded_at
         FROM user_resume_documents
         WHERE id=COALESCE($1, (
           SELECT id
           FROM user_resume_documents
           WHERE user_id=$2 AND is_current=true AND deleted_at IS NULL
           LIMIT 1
         ))
         AND deleted_at IS NULL`,
        [requestRecord.resume_document_id, requestRecord.user_id]
      ),
    ]);

    const profile = profileResult.rows[0] || {};
    const resume = resumeResult.rows[0] || null;

    res.json({
      success: true,
      profile: {
        professionalSummary: profile.professional_summary || "",
        currentJobTitle: profile.current_job_title || "",
        industry: profile.industry || "",
        yearsOfExperience: profile.years_of_experience ?? null,
        targetRole: profile.target_role || "",
        skills: profile.skills || [],
        careerGoals: profile.career_goals || "",
        linkedinUrl: profile.linkedin_url || "",
      },
      resume: resume
        ? {
            id: resume.id,
            originalFileName: resume.original_file_name,
            mimeType: resume.mime_type,
            sizeBytes: resume.size_bytes,
            uploadedAt: resume.uploaded_at,
          }
        : null,
      serviceContact: requestRecord.service_phone_e164
        ? {
            phone: requestRecord.service_phone_e164,
            consentAt: requestRecord.service_contact_consent_at,
          }
        : null,
    });
  })
);

module.exports = router;
