const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const express = require("express");
const multer = require("multer");
const { z } = require("zod");

const env = require("../config/env");
const { pool } = require("../db/pool");
const { authenticateToken, requireRoles } = require("../middleware/authMiddleware");
const { validateParams } = require("../middleware/validateParams");
const { validateRequest } = require("../middleware/validateRequest");
const { createAuditLog } = require("../services/auditService");
const {
  deleteResumeObject,
  getResumeObjectPath,
  writeResumeObject,
} = require("../services/storage/resumeStorage");
const asyncHandler = require("../utils/asyncHandler");
const { normalizePhone } = require("../utils/phone");

const router = express.Router();
const tempDirectory = path.resolve(env.uploads.tempDirectory);
fs.mkdirSync(tempDirectory, { recursive: true });

const allowedExtensionsByMime = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

const upload = multer({
  dest: tempDirectory,
  limits: { fileSize: env.uploads.maxResumeBytes, files: 1 },
  fileFilter: (_, file, cb) => {
    if (!env.uploads.allowedResumeMimeTypes.includes(file.mimetype)) {
      return cb(new Error("Only PDF and DOCX resume files are allowed."));
    }

    return cb(null, true);
  },
});

const profileSchema = z
  .object({
    professionalSummary: z.string().trim().max(5000).optional().or(z.literal("")),
    currentJobTitle: z.string().trim().max(150).optional().or(z.literal("")),
    industry: z.string().trim().max(150).optional().or(z.literal("")),
    yearsOfExperience: z.number().int().min(0).max(60).nullable().optional(),
    targetRole: z.string().trim().max(150).optional().or(z.literal("")),
    skills: z
      .array(z.string().trim().min(1).max(100))
      .max(30)
      .optional()
      .default([]),
    careerGoals: z.string().trim().max(5000).optional().or(z.literal("")),
    linkedinUrl: z.string().trim().url().max(2000).optional().or(z.literal("")),
  })
  .strict();

const serviceContactSchema = z
  .object({
    phoneCountryCode: z
      .string()
      .trim()
      .min(2, "Select a country code.")
      .max(8, "Select a valid country code."),
    phoneNumber: z
      .string()
      .trim()
      .min(4, "Enter a valid phone number.")
      .max(30, "Enter a valid phone number."),
    serviceCommunicationConsent: z.literal(true, {
      message:
        "Consent is required before we can contact you about this request.",
    }),
  })
  .strict();

const resumeIdParamsSchema = z.object({ resumeId: z.string().uuid() }).strict();

function mapProfile(row = {}) {
  return {
    professionalSummary: row.professional_summary || "",
    currentJobTitle: row.current_job_title || "",
    industry: row.industry || "",
    yearsOfExperience: row.years_of_experience ?? null,
    targetRole: row.target_role || "",
    skills: row.skills || [],
    careerGoals: row.career_goals || "",
    linkedinUrl: row.linkedin_url || "",
    updatedAt: row.updated_at || null,
  };
}

function mapResume(row) {
  if (!row) return null;

  return {
    id: row.id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
  };
}

function mapContact(row) {
  return {
    phone: row.phone || null,
    phoneCountryCode: row.phone_country_code || "",
    phoneNumber: row.phone_number || "",
    phoneE164: row.phone_e164 || null,
    serviceCommunicationConsentAt: row.service_contact_consent_at || null,
    readyForServiceContact: Boolean(
      row.phone_country_code &&
        row.phone_number &&
        row.phone_e164 &&
        row.service_contact_consent_at
    ),
  };
}

function safeDownloadFileName(fileName) {
  const baseName = path.basename(fileName || "resume");
  return baseName.replace(/["\r\n]/g, "_") || "resume";
}

async function validateResumeFile(file) {
  const extension = path.extname(file.originalname).slice(1).toLowerCase();
  const expectedExtension = allowedExtensionsByMime[file.mimetype];

  if (!expectedExtension || extension !== expectedExtension) {
    throw new Error("Resume file extension must match its PDF or DOCX type.");
  }

  const handle = await fs.promises.open(file.path, "r");

  try {
    const header = Buffer.alloc(8);
    await handle.read(header, 0, 8, 0);

    if (extension === "pdf" && header.subarray(0, 5).toString() !== "%PDF-") {
      throw new Error("The uploaded PDF does not appear to be a valid PDF file.");
    }

    if (extension === "docx" && header.subarray(0, 2).toString() !== "PK") {
      throw new Error("The uploaded DOCX does not appear to be a valid DOCX file.");
    }
  } finally {
    await handle.close();
  }

  const checksum = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file.path);
    stream.on("data", (chunk) => checksum.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return { extension, checksumSha256: checksum.digest("hex") };
}

router.get(
  "/me/career-profile",
  authenticateToken,
  requireRoles("user"),
  asyncHandler(async (req, res) => {
    const [profileResult, resumeResult, userResult] = await Promise.all([
      pool.query("SELECT * FROM user_career_profiles WHERE user_id=$1", [
        req.user.id,
      ]),
      pool.query(
        `SELECT id, original_file_name, mime_type, size_bytes, uploaded_at
         FROM user_resume_documents
         WHERE user_id=$1 AND is_current=true AND deleted_at IS NULL`,
        [req.user.id]
      ),
      pool.query(
        `SELECT phone, phone_country_code, phone_number, phone_e164, service_contact_consent_at
         FROM users
         WHERE id=$1`,
        [req.user.id]
      ),
    ]);

    res.json({
      success: true,
      profile: mapProfile(profileResult.rows[0]),
      resume: mapResume(resumeResult.rows[0]),
      contact: mapContact(userResult.rows[0] || {}),
    });
  })
);

router.put(
  "/me/career-profile",
  authenticateToken,
  requireRoles("user"),
  validateRequest(profileSchema),
  asyncHandler(async (req, res) => {
    const profile = req.validatedBody;
    const result = await pool.query(
      `INSERT INTO user_career_profiles(
        user_id,
        professional_summary,
        current_job_title,
        industry,
        years_of_experience,
        target_role,
        skills,
        career_goals,
        linkedin_url
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(user_id) DO UPDATE SET
        professional_summary=EXCLUDED.professional_summary,
        current_job_title=EXCLUDED.current_job_title,
        industry=EXCLUDED.industry,
        years_of_experience=EXCLUDED.years_of_experience,
        target_role=EXCLUDED.target_role,
        skills=EXCLUDED.skills,
        career_goals=EXCLUDED.career_goals,
        linkedin_url=EXCLUDED.linkedin_url,
        updated_at=NOW()
      RETURNING *`,
      [
        req.user.id,
        profile.professionalSummary || null,
        profile.currentJobTitle || null,
        profile.industry || null,
        profile.yearsOfExperience ?? null,
        profile.targetRole || null,
        JSON.stringify(profile.skills || []),
        profile.careerGoals || null,
        profile.linkedinUrl || null,
      ]
    );

    await createAuditLog({
      actorUserId: req.user.id,
      action: "CAREER_PROFILE_UPDATED",
      entityType: "user_career_profile",
      entityId: req.user.id,
      newValues: { profileCompleted: true },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({
      success: true,
      message: "Career profile saved.",
      profile: mapProfile(result.rows[0]),
    });
  })
);

router.put(
  "/me/service-contact",
  authenticateToken,
  requireRoles("user"),
  validateRequest(serviceContactSchema),
  asyncHandler(async (req, res) => {
    const normalized = normalizePhone(
      req.validatedBody.phoneCountryCode,
      req.validatedBody.phoneNumber
    );

    if (!normalized.valid) {
      return res.status(400).json({ success: false, message: normalized.message });
    }

    const result = await pool.query(
      `UPDATE users
       SET
         phone=$2,
         phone_country_code=$3,
         phone_number=$4,
         phone_e164=$5,
         service_contact_consent_at=NOW(),
         service_contact_consent_ip=$6,
         service_contact_consent_user_agent=$7,
         updated_at=NOW()
       WHERE id=$1
       RETURNING phone, phone_country_code, phone_number, phone_e164, service_contact_consent_at`,
      [
        req.user.id,
        normalized.phoneE164,
        normalized.countryCode,
        normalized.phoneNumber,
        normalized.phoneE164,
        req.ip,
        req.get("user-agent") || null,
      ]
    );

    await createAuditLog({
      actorUserId: req.user.id,
      action: "SERVICE_CONTACT_UPDATED",
      entityType: "user",
      entityId: req.user.id,
      newValues: {
        phoneE164: normalized.phoneE164,
        serviceCommunicationConsent: true,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({
      success: true,
      message: "Service contact phone saved.",
      contact: mapContact(result.rows[0]),
    });
  })
);

router.post(
  "/me/career-profile/resume",
  authenticateToken,
  requireRoles("user"),
  (req, res, next) =>
    upload.single("resume")(req, res, (error) => {
      if (!error) {
        return next();
      }

      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "This resume file is too large. Please upload a file within the allowed size."
          : error.message;

      return res.status(400).json({ success: false, message });
    }),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Resume file is required." });
    }

    let validation;

    try {
      validation = await validateResumeFile(req.file);
    } catch (error) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ success: false, message: error.message });
    }

    const storageKey = `${req.user.id}/${crypto.randomUUID()}.${validation.extension}`;
    let storage = null;
    const client = await pool.connect();

    try {
      storage = await writeResumeObject({
        storageKey,
        sourcePath: req.file.path,
      });

      await client.query("BEGIN");

      const previousResult = await client.query(
        `SELECT id, storage_key
         FROM user_resume_documents
         WHERE user_id=$1 AND is_current=true AND deleted_at IS NULL
         FOR UPDATE`,
        [req.user.id]
      );

      if (previousResult.rowCount) {
        await client.query(
          `UPDATE user_resume_documents
           SET is_current=false
           WHERE id=$1`,
          [previousResult.rows[0].id]
        );
      }

      const resumeResult = await client.query(
        `INSERT INTO user_resume_documents(
          user_id,
          original_file_name,
          storage_key,
          storage_provider,
          mime_type,
          size_bytes,
          is_current,
          file_extension,
          checksum_sha256,
          uploaded_by
        )
        VALUES($1,$2,$3,$4,$5,$6,true,$7,$8,$9)
        RETURNING *`,
        [
          req.user.id,
          req.file.originalname,
          storage.storageKey,
          storage.provider,
          req.file.mimetype,
          req.file.size,
          validation.extension,
          validation.checksumSha256,
          req.user.id,
        ]
      );

      if (previousResult.rowCount) {
        await client.query(
          `UPDATE user_resume_documents
           SET replaced_by_document_id=$2
           WHERE id=$1`,
          [previousResult.rows[0].id, resumeResult.rows[0].id]
        );
      }

      await createAuditLog({
        actorUserId: req.user.id,
        action: previousResult.rowCount
          ? "CAREER_RESUME_REPLACED"
          : "CAREER_RESUME_UPLOADED",
        entityType: "user_resume_document",
        entityId: resumeResult.rows[0].id,
        newValues: {
          originalFileName: req.file.originalname,
          sizeBytes: req.file.size,
          mimeType: req.file.mimetype,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        dbClient: client,
      });

      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        message: previousResult.rowCount ? "Resume replaced." : "Resume uploaded.",
        resume: mapResume(resumeResult.rows[0]),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      await fs.promises.unlink(req.file.path).catch(() => {});
      await deleteResumeObject(storage?.storageKey || storageKey).catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/resumes/:resumeId/download",
  authenticateToken,
  validateParams(resumeIdParamsSchema),
  asyncHandler(async (req, res) => {
    const resumeResult = await pool.query(
      `SELECT
        d.*,
        EXISTS (
          SELECT 1
          FROM service_requests sr
          WHERE sr.resume_document_id=d.id
            AND sr.assigned_counsellor_id=$2
        ) AS assigned_counsellor,
        EXISTS (
          SELECT 1
          FROM service_requests sr
          WHERE sr.resume_document_id=d.id
            AND sr.user_id=$2
        ) AS owner_request_resume
       FROM user_resume_documents d
       WHERE d.id=$1 AND d.deleted_at IS NULL`,
      [req.validatedParams.resumeId, req.user.id]
    );

    if (!resumeResult.rowCount) {
      return res.status(404).json({ success: false, message: "Resume not found." });
    }

    const document = resumeResult.rows[0];
    const allowed =
      req.user.role === "admin" ||
      req.user.id === document.user_id ||
      (req.user.role === "counsellor" && document.assigned_counsellor);

    if (!allowed) {
      return res
        .status(403)
        .json({ success: false, message: "You do not have access to this resume." });
    }

    const filePath = getResumeObjectPath(document.storage_key);

    if (!fs.existsSync(filePath)) {
      return res
        .status(404)
        .json({ success: false, message: "Resume file is unavailable." });
    }

    await createAuditLog({
      actorUserId: req.user.id,
      action: "CAREER_RESUME_DOWNLOADED",
      entityType: "user_resume_document",
      entityId: document.id,
      newValues: { ownerUserId: document.user_id },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.setHeader(
      "Content-Type",
      document.mime_type || "application/octet-stream"
    );
    res.setHeader("Content-Length", document.size_bytes);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeDownloadFileName(document.original_file_name)}"`
    );

    const stream = fs.createReadStream(filePath);
    stream.on("error", (error) => {
      if (!res.headersSent) {
        return res
          .status(500)
          .json({ success: false, message: "Unable to stream resume file." });
      }

      return res.destroy(error);
    });
    stream.pipe(res);
  })
);

module.exports = router;
