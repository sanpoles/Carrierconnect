const express = require("express");
const { z } = require("zod");

const env = require("../config/env");
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
const { notifyUser } = require("../services/notificationService");
const { assertCounsellorAvailable } = require("../services/availabilityService");
const {
  canScheduleForEngagement,
  getDeliveryState,
} = require("../services/entitlementService");
const { normalizePhone } = require("../utils/phone");

const router = express.Router();

function envRequire(featureName) {
  return env.features[featureName] !== false;
}

const requestIdParamsSchema = z
  .object({
    requestId: z.string().uuid("Request ID must be a valid UUID."),
  })
  .strict();

const proposalSelectionParamsSchema = z
  .object({
    requestId: z.string().uuid("Request ID must be a valid UUID."),
    proposalId: z.string().uuid("Proposal ID must be a valid UUID."),
    optionId: z.string().uuid("Option ID must be a valid UUID."),
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

function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const isoDateTimeSchema = z
  .string()
  .trim()
  .min(20, "Date/time must be a valid ISO-8601 value.")
  .max(50, "Date/time value is too long.")
  .refine(
    (value) =>
      /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
      !Number.isNaN(Date.parse(value)),
    {
      message:
        "Date/time must include a timezone offset, for example 2026-06-30T10:00:00+05:30.",
    }
  );

const timezoneSchema = z
  .string()
  .trim()
  .min(3, "Timezone is required.")
  .max(100, "Timezone cannot exceed 100 characters.")
  .refine(isValidTimezone, {
    message: "Timezone must be a valid IANA timezone such as Asia/Kolkata.",
  });

const preferredSlotSchema = z
  .object({
    scheduledStartAt: isoDateTimeSchema,
    scheduledEndAt: isoDateTimeSchema,
    timezone: timezoneSchema.default("Asia/Kolkata"),
  })
  .strict()
  .refine(
    (slot) =>
      new Date(slot.scheduledStartAt).getTime() >
      Date.now() + 5 * 60 * 1000,
    {
      message: "Preferred date and time options must be in the future.",
      path: ["scheduledStartAt"],
    }
  )
  .refine(
    (slot) =>
      new Date(slot.scheduledEndAt).getTime() >
      new Date(slot.scheduledStartAt).getTime(),
    {
      message: "Preferred option end time must be after the start time.",
      path: ["scheduledEndAt"],
    }
  );

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

    preferredSlots: z
      .array(preferredSlotSchema)
      .min(2, "Add at least two preferred date and time options.")
      .max(3, "You can provide up to three preferred date and time options.")
      .refine(
        (slots) => {
          const keys = slots.map(
            (slot) => `${slot.scheduledStartAt}|${slot.scheduledEndAt}`
          );
          return new Set(keys).size === keys.length;
        },
        { message: "Preferred date and time options cannot be duplicates." }
      ),

    resumeUrl: z
      .string()
      .trim()
      .url("Resume URL must be valid.")
      .max(2000, "Resume URL is too long.")
      .optional()
      .or(z.literal("")),

    serviceContact: z
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
      .optional(),

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
    preferredSlots: record.preferred_slots || [],
    slotProposals: record.slot_proposals || [],
    schedulingStatus: record.scheduling_status || "requested_preferences",

    resumeUrl: record.resume_url,
    resumeDocument: record.resume_document_id
      ? {
          id: record.resume_document_id,
          originalFileName: record.resume_original_file_name || null,
          mimeType: record.resume_mime_type || null,
          sizeBytes: record.resume_size_bytes || null,
          uploadedAt: record.resume_uploaded_at || null,
        }
      : null,
    additionalDetails: record.additional_details || {},

    user: record.user_id
      ? {
          id: record.user_id,
          fullName: record.user_full_name,
          email: record.user_email,
          phone: record.user_phone || null,
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

function mapPreferredSlot(row) {
  return {
    id: row.id,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    timezone: row.timezone,
    displayOrder: row.display_order,
    source: "user_preference",
  };
}

function mapProposal(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    counsellorId: row.counsellor_id,
    message: row.message,
    status: row.status,
    selectedOptionId: row.selected_option_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    options: row.options || [],
  };
}

function mapSessionRecord(record) {
  return {
    id: record.id,
    requestId: record.request_id,
    requestNumber: record.request_number,
    title: record.title,
    scheduledStartAt: record.scheduled_start_at,
    scheduledEndAt: record.scheduled_end_at,
    timezone: record.timezone,
    meetingProvider: record.meeting_provider,
    meetingLink: record.meeting_link,
    status: record.status,
    user: record.user_id
      ? {
          id: record.user_id,
          fullName: record.user_full_name,
          email: record.user_email,
        }
      : null,
    counsellor: record.counsellor_id
      ? {
          id: record.counsellor_id,
          fullName: record.counsellor_full_name,
          email: record.counsellor_email,
        }
      : null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

async function getSchedulingDetails(requestId, dbClient = pool) {
  const [slotResult, proposalResult] = await Promise.all([
    dbClient.query(
      `SELECT id, scheduled_start_at, scheduled_end_at, timezone, display_order
       FROM service_request_preferred_slots
       WHERE request_id=$1
       ORDER BY display_order ASC`,
      [requestId]
    ),
    dbClient.query(
      `SELECT
        p.id,
        p.request_id,
        p.counsellor_id,
        p.message,
        p.status,
        p.selected_option_id,
        p.created_at,
        p.updated_at,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', o.id,
              'scheduledStartAt', o.scheduled_start_at,
              'scheduledEndAt', o.scheduled_end_at,
              'timezone', o.timezone,
              'displayOrder', o.display_order,
              'status', o.status,
              'source', 'counsellor_alternative'
            )
            ORDER BY o.display_order
          ) FILTER (WHERE o.id IS NOT NULL),
          '[]'::jsonb
        ) AS options
       FROM session_slot_proposals p
       LEFT JOIN session_slot_proposal_options o ON o.proposal_id=p.id
       WHERE p.request_id=$1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [requestId]
    ),
  ]);

  return {
    preferredSlots: slotResult.rows.map(mapPreferredSlot),
    slotProposals: proposalResult.rows.map(mapProposal),
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
    sr.scheduling_status,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ps.id,
          'scheduledStartAt', ps.scheduled_start_at,
          'scheduledEndAt', ps.scheduled_end_at,
          'timezone', ps.timezone,
          'displayOrder', ps.display_order,
          'source', 'user_preference'
        )
        ORDER BY ps.display_order
      )
      FROM service_request_preferred_slots ps
      WHERE ps.request_id = sr.id
    ), '[]'::jsonb) AS preferred_slots,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'requestId', p.request_id,
          'counsellorId', p.counsellor_id,
          'message', p.message,
          'status', p.status,
          'selectedOptionId', p.selected_option_id,
          'createdAt', p.created_at,
          'updatedAt', p.updated_at,
          'options', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'scheduledStartAt', o.scheduled_start_at,
                'scheduledEndAt', o.scheduled_end_at,
                'timezone', o.timezone,
                'displayOrder', o.display_order,
                'status', o.status,
                'source', 'counsellor_alternative'
              )
              ORDER BY o.display_order
            )
            FROM session_slot_proposal_options o
            WHERE o.proposal_id = p.id
          ), '[]'::jsonb)
        )
        ORDER BY p.created_at DESC
      )
      FROM session_slot_proposals p
      WHERE p.request_id = sr.id
    ), '[]'::jsonb) AS slot_proposals,
    sr.resume_url,
    sr.resume_document_id,
    sr.service_phone_e164,
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
    request_user.phone AS user_phone,

    resume_document.original_file_name AS resume_original_file_name,
    resume_document.mime_type AS resume_mime_type,
    resume_document.size_bytes AS resume_size_bytes,
    resume_document.uploaded_at AS resume_uploaded_at,

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
  LEFT JOIN user_resume_documents resume_document ON resume_document.id = sr.resume_document_id
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

async function getRequestReadiness(userId, dbClient = pool) {
  const [userResult, resumeResult] = await Promise.all([
    dbClient.query(
      `SELECT
        phone_country_code,
        phone_number,
        phone_e164,
        service_contact_consent_at
       FROM users
       WHERE id=$1`,
      [userId]
    ),
    dbClient.query(
      `SELECT id, original_file_name, mime_type, size_bytes, uploaded_at
       FROM user_resume_documents
       WHERE user_id=$1 AND is_current=true AND deleted_at IS NULL`,
      [userId]
    ),
  ]);

  const user = userResult.rows[0] || {};
  const hasServiceContact = Boolean(
    user.phone_country_code &&
      user.phone_number &&
      user.phone_e164 &&
      user.service_contact_consent_at
  );

  return {
    hasServiceContact,
    contact: user,
    resume: resumeResult.rows[0] || null,
  };
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
      preferredSlots,
      resumeUrl,
      serviceContact,
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

    const requestReadiness = await getRequestReadiness(req.user.id);
    let servicePhone = null;

    if (envRequire("requireRequestPhone") && !requestReadiness.hasServiceContact) {
      if (!serviceContact) {
        return res.status(409).json({
          success: false,
          message:
            "Add a service contact phone number and consent before submitting this request.",
          missingServiceContact: true,
        });
      }

      const normalized = normalizePhone(
        serviceContact.phoneCountryCode,
        serviceContact.phoneNumber
      );

      if (!normalized.valid) {
        return res.status(400).json({
          success: false,
          message: normalized.message,
        });
      }

      servicePhone = normalized;
    } else if (requestReadiness.hasServiceContact) {
      servicePhone = {
        countryCode: requestReadiness.contact.phone_country_code,
        phoneNumber: requestReadiness.contact.phone_number,
        phoneE164: requestReadiness.contact.phone_e164,
      };
    }

    if (envRequire("requireRequestResume") && !requestReadiness.resume) {
      return res.status(409).json({
        success: false,
        message:
          "Upload a PDF or DOCX resume before submitting this support request.",
        missingResume: true,
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
              WITH updated_user AS (
                UPDATE users
                SET
                  phone = COALESCE($16, phone),
                  phone_country_code = COALESCE($17, phone_country_code),
                  phone_number = COALESCE($18, phone_number),
                  phone_e164 = COALESCE($19, phone_e164),
                  service_contact_consent_at = CASE
                    WHEN $16::text IS NOT NULL THEN NOW()
                    ELSE service_contact_consent_at
                  END,
                  service_contact_consent_ip = CASE
                    WHEN $16::text IS NOT NULL THEN $20::inet
                    ELSE service_contact_consent_ip
                  END,
                  service_contact_consent_user_agent = CASE
                    WHEN $16::text IS NOT NULL THEN $21::text
                    ELSE service_contact_consent_user_agent
                  END,
                  updated_at = NOW()
                WHERE id = $2
              )
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
                resume_document_id,
                service_phone_country_code,
                service_phone_number,
                service_phone_e164,
                service_contact_consent_at,
                service_contact_consent_ip,
                service_contact_consent_user_agent,
                additional_details
              )
              VALUES (
                $1, $2, $3, 'submitted', $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14, $22,
                $17, $18, $19, NOW(), $20, $21, $15
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
              servicePhone?.phoneE164 || null,
              servicePhone?.countryCode || null,
              servicePhone?.phoneNumber || null,
              servicePhone?.phoneE164 || null,
              req.ip,
              req.get("user-agent") || null,
              requestReadiness.resume?.id || null,
            ]
          );

          createdRequest = requestResult.rows[0];

          for (const [index, slot] of preferredSlots.entries()) {
            await client.query(
              `INSERT INTO service_request_preferred_slots(
                request_id,
                user_id,
                scheduled_start_at,
                scheduled_end_at,
                timezone,
                display_order
              )
              VALUES($1,$2,$3,$4,$5,$6)`,
              [
                createdRequest.id,
                req.user.id,
                slot.scheduledStartAt,
                slot.scheduledEndAt,
                slot.timezone,
                index + 1,
              ]
            );
          }

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
              resumeDocumentId: createdRequest.resume_document_id,
              serviceContactProvided: Boolean(createdRequest.service_phone_e164),
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

      try {
        await notifyUser({
          userId: req.user.id,
          userEmail: req.user.email,
          requestId: createdRequest.id,
          notificationType: "request_submitted",
          title: "Your request was submitted",
          message: `We received ${createdRequest.request_number}. CareerConnect will review it and keep updates in your workspace.`,
          actionUrl: `/app/workspace?requestId=${createdRequest.id}`,
          emailSubject: `Request submitted: ${createdRequest.request_number}`,
          emailText: `Hello ${req.user.full_name},\n\nWe received your ${createdRequest.request_type === "mock_interview" ? "Mock Interview" : "Career Guidance"} request (${createdRequest.request_number}). You can follow updates in your CareerConnect workspace.`,
        });
      } catch (error) {
        console.error("Unable to create request submission notification:", {
          requestId: createdRequest.id,
          userId: req.user.id,
          message: error.message,
        });
      }

      res.status(201).json({
        success: true,
        message: "Your request has been submitted successfully.",
        request: mapRequestRecord({
          ...createdRequest,
          preferred_slots: preferredSlots.map((slot, index) => ({
            id: null,
            scheduled_start_at: slot.scheduledStartAt,
            scheduled_end_at: slot.scheduledEndAt,
            timezone: slot.timezone,
            display_order: index + 1,
          })).map(mapPreferredSlot),
          slot_proposals: [],
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

router.get(
  "/:requestId/scheduling",
  authenticateToken,
  requireRoles("user"),
  validateParams(requestIdParamsSchema),
  asyncHandler(async (req, res) => {
    const requestResult = await pool.query(
      `SELECT id, scheduling_status
       FROM service_requests
       WHERE id=$1 AND user_id=$2`,
      [req.validatedParams.requestId, req.user.id]
    );

    if (!requestResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Request not found.",
      });
    }

    const scheduling = await getSchedulingDetails(req.validatedParams.requestId);

    return res.status(200).json({
      success: true,
      requestId: req.validatedParams.requestId,
      schedulingStatus: requestResult.rows[0].scheduling_status,
      ...scheduling,
    });
  })
);

router.post(
  "/:requestId/slot-proposals/:proposalId/options/:optionId/select",
  authenticateToken,
  requireRoles("user"),
  validateParams(proposalSelectionParamsSchema),
  asyncHandler(async (req, res) => {
    const { requestId, proposalId, optionId } = req.validatedParams;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `SELECT
          sr.id AS request_id,
          sr.request_number,
          sr.user_id,
          sr.assigned_counsellor_id,
          sr.status AS request_status,
          request_user.full_name AS user_full_name,
          request_user.email AS user_email,
          p.id AS proposal_id,
          p.status AS proposal_status,
          o.id AS option_id,
          o.scheduled_start_at,
          o.scheduled_end_at,
          o.timezone,
          o.status AS option_status
         FROM service_requests sr
         INNER JOIN users request_user ON request_user.id=sr.user_id
         INNER JOIN session_slot_proposals p ON p.request_id=sr.id
         INNER JOIN session_slot_proposal_options o ON o.proposal_id=p.id
         WHERE sr.id=$1
           AND sr.user_id=$2
           AND p.id=$3
           AND o.id=$4
         FOR UPDATE`,
        [requestId, req.user.id, proposalId, optionId]
      );

      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "Scheduling option not found.",
        });
      }

      const record = result.rows[0];

      if (record.proposal_status !== "proposed" || record.option_status !== "proposed") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "This proposed slot is no longer available for selection.",
        });
      }

      const deliveryState = await getDeliveryState(requestId, {
        dbClient: client,
        forUpdate: true,
      });
      const permission = canScheduleForEngagement(deliveryState);

      if (!permission.allowed) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: permission.reason });
      }

      const startsAt = new Date(record.scheduled_start_at);
      const endsAt = new Date(record.scheduled_end_at);
      const availability = await assertCounsellorAvailable({
        counsellorId: record.assigned_counsellor_id,
        startAt: startsAt,
        endAt: endsAt,
        dbClient: client,
      });

      if (!availability.allowed) {
        await client.query(
          "UPDATE session_slot_proposal_options SET status='unavailable' WHERE id=$1",
          [optionId]
        );
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message:
            "That proposed slot is no longer available. Please ask your counsellor for new options.",
        });
      }

      const conflictResult = await client.query(
        `SELECT id
         FROM sessions
         WHERE counsellor_id=$1
           AND status='scheduled'
           AND scheduled_start_at<$3
           AND scheduled_end_at>$2
         FOR UPDATE`,
        [record.assigned_counsellor_id, startsAt.toISOString(), endsAt.toISOString()]
      );

      if (conflictResult.rowCount) {
        await client.query(
          "UPDATE session_slot_proposal_options SET status='unavailable' WHERE id=$1",
          [optionId]
        );
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message:
            "That proposed slot was just booked. Please ask your counsellor for new options.",
        });
      }

      const sessionResult = await client.query(
        `INSERT INTO sessions(
          request_id,
          user_id,
          counsellor_id,
          title,
          scheduled_start_at,
          scheduled_end_at,
          timezone,
          meeting_provider,
          status
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,'To be confirmed','scheduled')
        RETURNING *`,
        [
          requestId,
          req.user.id,
          record.assigned_counsellor_id,
          `${record.request_number} - Session`,
          startsAt.toISOString(),
          endsAt.toISOString(),
          record.timezone,
        ]
      );

      await client.query(
        `UPDATE session_slot_proposals
         SET status='confirmed', selected_option_id=$2, updated_at=NOW()
         WHERE id=$1`,
        [proposalId, optionId]
      );
      await client.query(
        "UPDATE session_slot_proposal_options SET status=CASE WHEN id=$2 THEN 'confirmed' ELSE 'cancelled' END WHERE proposal_id=$1",
        [proposalId, optionId]
      );
      await client.query(
        `UPDATE service_requests
         SET status='session_scheduled',
             scheduling_status='confirmed',
             scheduling_status_updated_at=NOW()
         WHERE id=$1`,
        [requestId]
      );

      await createAuditLog({
        actorUserId: req.user.id,
        action: "SESSION_SLOT_SELECTED",
        entityType: "session_slot_proposal",
        entityId: proposalId,
        requestId,
        newValues: {
          optionId,
          scheduledStartAt: startsAt.toISOString(),
          scheduledEndAt: endsAt.toISOString(),
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        dbClient: client,
      });

      await client.query("COMMIT");

      await notifyUser({
        userId: record.assigned_counsellor_id,
        userEmail: record.counsellor_email,
        requestId,
        sessionId: sessionResult.rows[0].id,
        notificationType: "session_scheduled",
        title: "A user selected a proposed session slot",
        message: `${record.user_full_name} selected a session option for ${record.request_number}.`,
        actionUrl: "/counsellor/dashboard",
        emailSubject: `Session confirmed: ${record.request_number}`,
        emailText: `Hello ${record.counsellor_full_name},\n\n${record.user_full_name} selected one of your proposed session options. Log in to CareerConnect to add the meeting link.`,
      });

      return res.status(201).json({
        success: true,
        message: "Your session has been confirmed.",
        schedulingStatus: "confirmed",
        session: mapSessionRecord({
          ...sessionResult.rows[0],
          request_number: record.request_number,
          user_full_name: record.user_full_name,
          user_email: record.user_email,
          counsellor_full_name: record.counsellor_full_name,
          counsellor_email: record.counsellor_email,
        }),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
