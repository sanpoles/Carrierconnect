const express = require("express");
const { z } = require("zod");

const { pool } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");
const { createRequestNumber } = require("../utils/requestNumber");
const {
  authenticateToken,
  requireRoles,
} = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const { validateParams } = require("../middleware/validateParams");
const { createAuditLog } = require("../services/auditService");

const router = express.Router();

const requestIdParamsSchema = z
  .object({
    requestId: z.string().uuid("Request ID must be a valid UUID."),
  })
  .strict();

const validDateSchema = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "Preferred date must use YYYY-MM-DD format."
  )
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "Preferred date is invalid.",
  });

const optionalText = (maxLength) =>
  z.string().trim().max(maxLength).optional().or(z.literal(""));

const requestCreateSchema = z
  .object({
    requestType: z.enum(["career_counselling", "mock_interview"], {
      message:
        "Request type must be career_counselling or mock_interview.",
    }),

    title: z
      .string()
      .trim()
      .min(5, "Title must contain at least 5 characters.")
      .max(250, "Title cannot exceed 250 characters.")
      .optional()
      .or(z.literal("")),

    description: z
      .string()
      .trim()
      .min(10, "Description must contain at least 10 characters.")
      .max(5000, "Description cannot exceed 5,000 characters."),

    industry: optionalText(150),

    currentJobTitle: optionalText(150),

    yearsOfExperience: z
      .number()
      .int("Years of experience must be a whole number.")
      .min(0, "Years of experience cannot be negative.")
      .max(60, "Years of experience cannot exceed 60.")
      .optional()
      .nullable(),

    targetRole: optionalText(150),

    skills: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Skill cannot be empty.")
          .max(100, "Each skill cannot exceed 100 characters.")
      )
      .max(30, "You can provide a maximum of 30 skills.")
      .optional()
      .default([]),

    preferredDate: validDateSchema.optional().or(z.literal("")),

    preferredTimeSlot: optionalText(100),

    timezone: z
      .string()
      .trim()
      .min(2, "Timezone is required.")
      .max(100, "Timezone cannot exceed 100 characters.")
      .default("Asia/Kolkata"),

    resumeUrl: z
      .string()
      .trim()
      .url("Resume URL must be valid.")
      .max(2000, "Resume URL is too long.")
      .optional()
      .or(z.literal("")),

    additionalDetails: z
      .record(z.string().max(100), z.unknown())
      .optional()
      .default({}),
  })
  .strict();

const cancelRequestSchema = z
  .object({
    cancellationReason: z
      .string()
      .trim()
      .min(5, "Cancellation reason must contain at least 5 characters.")
      .max(1000, "Cancellation reason cannot exceed 1,000 characters."),
  })
  .strict();

function buildDefaultTitle(requestType) {
  if (requestType === "mock_interview") {
    return "Mock Interview Request";
  }

  return "Career Counselling Request";
}

function mapRequestRecord(record) {
  return {
    id: record.id,
    requestNumber: record.request_number,
    requestType: record.request_type,
    status: record.status,

    title: record.title,
    description: record.description,

    industry: record.industry,
    currentJobTitle: record.current_job_title,
    yearsOfExperience: record.years_of_experience,
    targetRole: record.target_role,
    skills: record.skills || [],

    preferredDate: record.preferred_date,
    preferredTimeSlot: record.preferred_time_slot,
    timezone: record.timezone,

    resumeUrl: record.resume_url,
    additionalDetails: record.additional_details || {},

    user: record.user_id
      ? {
          id: record.user_id,
          fullName: record.user_full_name,
          email: record.user_email,
        }
      : null,

    assignedCounsellor: record.assigned_counsellor_id
      ? {
          id: record.assigned_counsellor_id,
          fullName: record.counsellor_full_name,
          email: record.counsellor_email,
        }
      : null,

    submittedAt: record.submitted_at,
    assignedAt: record.assigned_at,
    completedAt: record.completed_at,
    cancelledAt: record.cancelled_at,
    cancellationReason: record.cancellation_reason,

    unreadMessageCount: Number(record.unread_message_count || 0),

    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

const requestSelectColumns = `
  SELECT
    sr.id,
    sr.request_number,
    sr.user_id,
    sr.assigned_counsellor_id,
    sr.request_type,
    sr.status,
    sr.title,
    sr.description,
    sr.industry,
    sr.current_job_title,
    sr.years_of_experience,
    sr.target_role,
    sr.skills,
    sr.preferred_date,
    sr.preferred_time_slot,
    sr.timezone,
    sr.resume_url,
    sr.additional_details,
    sr.submitted_at,
    sr.assigned_at,
    sr.completed_at,
    sr.cancelled_at,
    sr.cancellation_reason,
    sr.created_at,
    sr.updated_at,

    request_user.full_name AS user_full_name,
    request_user.email AS user_email,

    counsellor.full_name AS counsellor_full_name,
    counsellor.email AS counsellor_email,

    (
      SELECT COUNT(*)
      FROM request_messages rm
      WHERE rm.request_id = sr.id
        AND rm.read_at IS NULL
        AND rm.sender_type IN ('counsellor', 'admin', 'system')
    ) AS unread_message_count

  FROM service_requests sr
  INNER JOIN users request_user ON request_user.id = sr.user_id
  LEFT JOIN users counsellor ON counsellor.id = sr.assigned_counsellor_id
`;


const requiredCareerProfileFields = [
  ["professional_summary", "Professional summary"],
  ["current_job_title", "Current role"],
  ["industry", "Industry"],
  ["years_of_experience", "Years of experience"],
  ["target_role", "Target role"],
  ["skills", "Key skills"],
  ["career_goals", "Career goals"],
];

async function getCareerProfileReadiness(userId, dbClient = pool) {
  const result = await dbClient.query(
    `
      SELECT
        professional_summary,
        current_job_title,
        industry,
        years_of_experience,
        target_role,
        skills,
        career_goals
      FROM user_career_profiles
      WHERE user_id = $1
    `,
    [userId]
  );

  if (!result.rowCount) {
    return {
      complete: false,
      missing: requiredCareerProfileFields.map(([, label]) => label),
    };
  }

  const profile = result.rows[0];
  const missing = requiredCareerProfileFields
    .filter(([column]) => {
      if (column === "years_of_experience") {
        return profile[column] === null || profile[column] === undefined;
      }

      if (column === "skills") {
        return !Array.isArray(profile[column]) || profile[column].length === 0;
      }

      return !String(profile[column] || "").trim();
    })
    .map(([, label]) => label);

  return { complete: missing.length === 0, missing };
}

router.post(
  "/",
  authenticateToken,
  requireRoles("user"),
  validateRequest(requestCreateSchema),
  asyncHandler(async (req, res) => {
    const {
      requestType,
      title,
      description,
      industry,
      currentJobTitle,
      yearsOfExperience,
      targetRole,
      skills,
      preferredDate,
      preferredTimeSlot,
      timezone,
      resumeUrl,
      additionalDetails,
    } = req.validatedBody;

    const profileReadiness = await getCareerProfileReadiness(req.user.id);

    if (!profileReadiness.complete) {
      return res.status(409).json({
        success: false,
        message: `Complete your Career Profile before submitting a request. Missing: ${profileReadiness.missing.join(", ")}. A resume is optional but recommended.`,
        missingCareerProfileFields: profileReadiness.missing,
      });
    }

    const client = await pool.connect();

    try {
      let createdRequest = null;
      let lastError = null;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const requestNumber = createRequestNumber(requestType);

        try {
          await client.query("BEGIN");

          const requestResult = await client.query(
            `
              INSERT INTO service_requests (
                request_number,
                user_id,
                request_type,
                status,
                title,
                description,
                industry,
                current_job_title,
                years_of_experience,
                target_role,
                skills,
                preferred_date,
                preferred_time_slot,
                timezone,
                resume_url,
                additional_details
              )
              VALUES (
                $1, $2, $3, 'submitted', $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14, $15
              )
              RETURNING *
            `,
            [
              requestNumber,
              req.user.id,
              requestType,
              title || buildDefaultTitle(requestType),
              description,
              industry || null,
              currentJobTitle || null,
              yearsOfExperience ?? null,
              targetRole || null,
              JSON.stringify(skills || []),
              preferredDate || null,
              preferredTimeSlot || null,
              timezone,
              resumeUrl || null,
              JSON.stringify(additionalDetails || {}),
            ]
          );

          createdRequest = requestResult.rows[0];

          await createAuditLog({
            actorUserId: req.user.id,
            action: "SERVICE_REQUEST_SUBMITTED",
            entityType: "service_request",
            entityId: createdRequest.id,
            requestId: createdRequest.id,
            newValues: {
              requestNumber: createdRequest.request_number,
              requestType: createdRequest.request_type,
              status: createdRequest.status,
            },
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
            dbClient: client,
          });

          await client.query("COMMIT");
          break;
        } catch (error) {
          await client.query("ROLLBACK");

          lastError = error;

          if (error.code !== "23505") {
            throw error;
          }
        }
      }

      if (!createdRequest) {
        throw lastError || new Error("Unable to create service request.");
      }

      res.status(201).json({
        success: true,
        message: "Your request has been submitted successfully.",
        request: mapRequestRecord({
          ...createdRequest,
          user_full_name: req.user.full_name,
          user_email: req.user.email,
          counsellor_full_name: null,
          counsellor_email: null,
          unread_message_count: 0,
        }),
      });
    } finally {
      client.release();
    }
  })
);

router.get(
  "/my",
  authenticateToken,
  requireRoles("user"),
  asyncHandler(async (req, res) => {
    const requestResult = await pool.query(
      `
        ${requestSelectColumns}
        WHERE sr.user_id = $1
        ORDER BY sr.created_at DESC
      `,
      [req.user.id]
    );

    res.status(200).json({
      success: true,
      count: requestResult.rowCount,
      requests: requestResult.rows.map(mapRequestRecord),
    });
  })
);

router.get(
  "/:requestId",
  authenticateToken,
  requireRoles("user"),
  validateParams(requestIdParamsSchema),
  asyncHandler(async (req, res) => {
    const { requestId } = req.validatedParams;

    const requestResult = await pool.query(
      `
        ${requestSelectColumns}
        WHERE sr.id = $1
          AND sr.user_id = $2
      `,
      [requestId, req.user.id]
    );

    if (requestResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      request: mapRequestRecord(requestResult.rows[0]),
    });
  })
);

router.patch(
  "/:requestId/cancel",
  authenticateToken,
  requireRoles("user"),
  validateParams(requestIdParamsSchema),
  validateRequest(cancelRequestSchema),
  asyncHandler(async (req, res) => {
    const { requestId } = req.validatedParams;
    const { cancellationReason } = req.validatedBody;

    const existingRequestResult = await pool.query(
      `
        SELECT
          id,
          request_number,
          status,
          cancellation_reason
        FROM service_requests
        WHERE id = $1
          AND user_id = $2
      `,
      [requestId, req.user.id]
    );

    if (existingRequestResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Request not found.",
      });
    }

    const existingRequest = existingRequestResult.rows[0];

    if (["completed", "closed", "cancelled"].includes(existingRequest.status)) {
      return res.status(409).json({
        success: false,
        message: `A request with status "${existingRequest.status}" cannot be cancelled.`,
      });
    }

    const cancelResult = await pool.query(
      `
        UPDATE service_requests
        SET
          status = 'cancelled',
          cancelled_at = NOW(),
          cancellation_reason = $1
        WHERE id = $2
          AND user_id = $3
        RETURNING *
      `,
      [cancellationReason, requestId, req.user.id]
    );

    const cancelledRequest = cancelResult.rows[0];

    await createAuditLog({
      actorUserId: req.user.id,
      action: "SERVICE_REQUEST_CANCELLED_BY_USER",
      entityType: "service_request",
      entityId: cancelledRequest.id,
      requestId: cancelledRequest.id,
      oldValues: {
        status: existingRequest.status,
        cancellationReason: existingRequest.cancellation_reason,
      },
      newValues: {
        status: cancelledRequest.status,
        cancellationReason: cancelledRequest.cancellation_reason,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    return res.status(200).json({
      success: true,
      message: "Your request has been cancelled.",
      request: mapRequestRecord({
        ...cancelledRequest,
        user_full_name: req.user.full_name,
        user_email: req.user.email,
        counsellor_full_name: null,
        counsellor_email: null,
        unread_message_count: 0,
      }),
    });
  })
);

module.exports = router;