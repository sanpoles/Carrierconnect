const express = require("express");
const { z } = require("zod");

const { pool } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");
const { authenticateToken, requireRoles } = require("../middleware/authMiddleware");
const { validateParams } = require("../middleware/validateParams");
const { validateQuery } = require("../middleware/validateQuery");
const { validateRequest } = require("../middleware/validateRequest");
const { assertCounsellorAvailable } = require("../services/availabilityService");
const { createAuditLog } = require("../services/auditService");
const { notifyUser } = require("../services/notificationService");
const {
  canScheduleForEngagement,
  getDeliveryState,
} = require("../services/entitlementService");

const router = express.Router();
router.use(authenticateToken);
router.use(requireRoles("counsellor"));

// PostgreSQL accepts legacy UUID values that may not carry RFC version/variant bits.
// Validate the canonical 8-4-4-4-12 hexadecimal shape without rejecting valid existing IDs.
const uuidShape = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Request ID must be a valid UUID."
);

const requestIdParamsSchema = z.object({
  requestId: uuidShape,
}).strict();

const acceptSlotParamsSchema = z.object({
  requestId: uuidShape,
  slotId: z.string().uuid("Preferred slot ID must be a valid UUID."),
}).strict();

function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const isoDateTimeSchema = z.string().trim().min(20).max(50).refine(
  (value) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && !Number.isNaN(Date.parse(value)),
  { message: "Date/time must include a timezone offset." }
);

const proposedSlotSchema = z.object({
  scheduledStartAt: isoDateTimeSchema,
  scheduledEndAt: isoDateTimeSchema,
  timezone: z.string().trim().min(3).max(100).refine(isValidTimezone, {
    message: "Timezone must be a valid IANA timezone.",
  }),
}).strict().refine(
  (slot) => new Date(slot.scheduledStartAt).getTime() > Date.now() + 5 * 60 * 1000,
  { message: "Proposed slots must be in the future.", path: ["scheduledStartAt"] }
).refine(
  (slot) => new Date(slot.scheduledEndAt).getTime() > new Date(slot.scheduledStartAt).getTime(),
  { message: "Proposed slot end time must be after start time.", path: ["scheduledEndAt"] }
);

const acceptPreferredSlotSchema = z.object({
  meetingProvider: z.string().trim().min(2).max(100).default("To be confirmed"),
  meetingLink: z.string().trim().url().max(2000).optional().or(z.literal("")),
}).strict();

const proposeAlternateSlotsSchema = z.object({
  message: z.string().trim().max(1000).optional().or(z.literal("")),
  slots: z.array(proposedSlotSchema)
    .min(2, "Propose at least two alternate options.")
    .max(3, "You can propose up to three alternate options.")
    .refine((slots) => {
      const keys = slots.map((slot) => `${slot.scheduledStartAt}|${slot.scheduledEndAt}`);
      return new Set(keys).size === keys.length;
    }, { message: "Proposed alternate options cannot be duplicates." }),
}).strict();

const queues = [
  "all",
  "needs_attention",
  "ready_for_counsellor",
  "active",
  "waiting_approval",
  "completed",
];

const counsellorRequestListQuerySchema = z.object({
  search: z.string().trim().max(200, "search cannot exceed 200 characters.").optional(),
  queue: z.enum(queues).optional().default("all"),
  page: z.string().regex(/^\d+$/, "page must be a number.").transform(Number).refine((value) => value >= 1, { message: "page must be at least 1." }).optional().default(1),
  pageSize: z.string().regex(/^\d+$/, "pageSize must be a number.").transform(Number).refine((value) => value >= 1 && value <= 100, { message: "pageSize must be between 1 and 100." }).optional().default(25),
  sortBy: z.enum(["updatedAt", "createdAt", "requestNumber"]).optional().default("updatedAt"),
  sortDirection: z.enum(["asc", "desc"]).optional().default("desc"),
}).strict();

function getOperationalState(record) {
  const granted = Number(record.sessions_granted || 0);
  const consumed = Number(record.sessions_consumed || 0);
  const remaining = Math.max(0, granted - consumed);
  const isLocked = Boolean(record.is_locked);
  const status = record.status;
  const final = ["completed", "cancelled", "closed"].includes(status);

  if (status === "cancelled") return "cancelled";
  if (status === "closed") return "closed";
  if (isLocked || status === "completed") return remaining <= 0 ? "exhausted" : "locked";
  if (remaining <= 0) return "waiting_approval";
  if (Boolean(record.has_counsellor_activity)) return "active";
  return "ready_for_counsellor";
}

function mapDeliveryState(record) {
  const sessionsGranted = Number(record.sessions_granted || 0);
  const sessionsConsumed = Number(record.sessions_consumed || 0);
  const sessionsRemaining = Math.max(0, sessionsGranted - sessionsConsumed);
  const operationalState = getOperationalState(record);
  const isLocked = Boolean(record.is_locked);
  const isFinalStatus = ["completed", "cancelled", "closed"].includes(record.status);

  let readOnlyMessage = null;
  if (isLocked) {
    readOnlyMessage = record.lock_reason || "This engagement is locked. Only an administrator can reopen or extend it.";
  } else if (isFinalStatus) {
    readOnlyMessage = `This ${record.status} engagement is read-only.`;
  } else if (sessionsRemaining <= 0) {
    readOnlyMessage = "Waiting for an administrator to approve sessions. You may review the request and message the user, but you cannot schedule a session yet.";
  }

  return {
    isLocked,
    lockedAt: record.locked_at,
    lockedBy: record.locked_by,
    lockReason: record.lock_reason,
    sessionsGranted,
    sessionsConsumed,
    sessionsRemaining,
    entitlementStatus: record.entitlement_status || "inactive",
    operationalState,
    hasCounsellorActivity: Boolean(record.has_counsellor_activity),
    hasAttention: Boolean(record.has_attention),
    canSendMessages: !isLocked && !isFinalStatus,
    canScheduleSessions: !isLocked && !isFinalStatus && sessionsRemaining > 0,
    canManageSessions: !isLocked && !isFinalStatus,
    readOnlyMessage,
  };
}

function mapCounsellorRequest(record) {
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
    schedulingStatus: record.scheduling_status || "requested_preferences",
    preferredSlots: record.preferred_slots || [],
    slotProposals: record.slot_proposals || [],
    user: { id: record.user_id, fullName: record.user_full_name, email: record.user_email },
    submittedAt: record.submitted_at,
    assignedAt: record.assigned_at,
    completedAt: record.completed_at,
    cancelledAt: record.cancelled_at,
    unreadMessageCount: Number(record.unread_message_count || 0),
    deliveryState: mapDeliveryState(record),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

const counsellorRequestSelect = `
  SELECT
    sr.id, sr.request_number, sr.user_id, sr.request_type, sr.status,
    sr.title, sr.description, sr.industry, sr.current_job_title,
    sr.years_of_experience, sr.target_role, sr.skills, sr.preferred_date,
    sr.preferred_time_slot, sr.timezone, sr.scheduling_status,
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
    sr.submitted_at, sr.assigned_at,
    sr.completed_at, sr.cancelled_at, sr.created_at, sr.updated_at,
    sr.is_locked, sr.locked_at, sr.locked_by, sr.lock_reason,
    COALESCE(se.sessions_granted, 0) AS sessions_granted,
    COALESCE(se.sessions_consumed, 0) AS sessions_consumed,
    COALESCE(se.status, 'inactive') AS entitlement_status,
    request_user.full_name AS user_full_name,
    request_user.email AS user_email,
    EXISTS (
      SELECT 1 FROM request_messages rm
      WHERE rm.request_id = sr.id
        AND rm.sender_type = 'counsellor'
    ) AS has_counsellor_activity,
    (
      SELECT COUNT(*)
      FROM request_messages rm
      WHERE rm.request_id = sr.id
        AND rm.read_at IS NULL
        AND rm.sender_type = 'user'
    ) AS unread_message_count,
    (
      (
        SELECT COUNT(*)
        FROM request_messages rm
        WHERE rm.request_id = sr.id
          AND rm.read_at IS NULL
          AND rm.sender_type = 'user'
      ) > 0
      OR EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.request_id = sr.id
          AND (
            s.status = 'reschedule_requested'
            OR (
              s.status = 'scheduled'
              AND s.scheduled_start_at >= date_trunc('day', NOW())
              AND s.scheduled_start_at < date_trunc('day', NOW()) + INTERVAL '1 day'
            )
          )
      )
    ) AS has_attention
  FROM service_requests sr
  INNER JOIN users request_user ON request_user.id = sr.user_id
  LEFT JOIN service_entitlements se ON se.request_id = sr.id
`;

function queueCondition(queue) {
  const baseOpen = `sr.is_locked = false AND sr.status NOT IN ('completed','cancelled','closed')`;
  const remaining = `COALESCE(se.sessions_granted, 0) - COALESCE(se.sessions_consumed, 0)`;
  const counsellorActivity = `EXISTS (SELECT 1 FROM request_messages cm WHERE cm.request_id = sr.id AND cm.sender_type = 'counsellor')`;
  const sessionActivity = `EXISTS (SELECT 1 FROM sessions ss WHERE ss.request_id = sr.id)`;
  const attention = `(
    EXISTS (SELECT 1 FROM request_messages um WHERE um.request_id = sr.id AND um.read_at IS NULL AND um.sender_type = 'user')
    OR EXISTS (
      SELECT 1 FROM sessions asn WHERE asn.request_id = sr.id
        AND (
          asn.status = 'reschedule_requested'
          OR (asn.status = 'scheduled'
            AND asn.scheduled_start_at >= date_trunc('day', NOW())
            AND asn.scheduled_start_at < date_trunc('day', NOW()) + INTERVAL '1 day')
        )
    )
  )`;

  switch (queue) {
    case "needs_attention":
      return attention;
    case "ready_for_counsellor":
      return `${baseOpen} AND ${remaining} > 0 AND NOT ${counsellorActivity} AND NOT ${sessionActivity}`;
    case "active":
      return `${baseOpen} AND ${remaining} > 0 AND (${counsellorActivity} OR ${sessionActivity})`;
    case "waiting_approval":
      return `${baseOpen} AND ${remaining} <= 0`;
    case "completed":
      return `(sr.is_locked = true OR sr.status IN ('completed','cancelled','closed'))`;
    default:
      return null;
  }
}

router.get("/dashboard", asyncHandler(async (req, res) => {
  const { id } = req.user;
  const result = await pool.query(
    `
      WITH assigned AS (
        SELECT
          sr.id, sr.status, sr.is_locked,
          COALESCE(se.sessions_granted,0) AS sessions_granted,
          COALESCE(se.sessions_consumed,0) AS sessions_consumed,
          EXISTS (
            SELECT 1 FROM request_messages cm
            WHERE cm.request_id = sr.id AND cm.sender_type = 'counsellor'
          ) AS has_counsellor_message,
          EXISTS (
            SELECT 1 FROM sessions sx WHERE sx.request_id = sr.id
          ) AS has_session,
          EXISTS (
            SELECT 1 FROM request_messages um
            WHERE um.request_id = sr.id AND um.sender_type='user' AND um.read_at IS NULL
          ) AS has_unread_user_message,
          EXISTS (
            SELECT 1 FROM sessions ax WHERE ax.request_id=sr.id
              AND (
                ax.status='reschedule_requested'
                OR (ax.status='scheduled' AND ax.scheduled_start_at >= date_trunc('day', NOW())
                    AND ax.scheduled_start_at < date_trunc('day', NOW()) + INTERVAL '1 day')
              )
          ) AS has_session_attention
        FROM service_requests sr
        LEFT JOIN service_entitlements se ON se.request_id = sr.id
        WHERE sr.assigned_counsellor_id = $1
      )
      SELECT
        COUNT(*) FILTER (WHERE has_unread_user_message OR has_session_attention) AS needs_attention,
        COUNT(*) FILTER (
          WHERE is_locked = false AND status NOT IN ('completed','cancelled','closed')
          AND sessions_granted - sessions_consumed > 0
          AND has_counsellor_message = false AND has_session = false
        ) AS ready_for_counsellor,
        COUNT(*) FILTER (
          WHERE is_locked = false AND status NOT IN ('completed','cancelled','closed')
          AND sessions_granted - sessions_consumed > 0
          AND (has_counsellor_message = true OR has_session = true)
        ) AS active_engagements,
        COUNT(*) FILTER (
          WHERE is_locked = false AND status NOT IN ('completed','cancelled','closed')
          AND sessions_granted - sessions_consumed <= 0
        ) AS waiting_for_approval,
        (
          SELECT COUNT(*) FROM sessions s
          WHERE s.counsellor_id=$1 AND s.status='scheduled'
            AND s.scheduled_start_at >= date_trunc('day', NOW())
            AND s.scheduled_start_at < date_trunc('day', NOW()) + INTERVAL '1 day'
        ) AS sessions_today,
        (
          SELECT COUNT(*) FROM sessions s
          WHERE s.counsellor_id=$1 AND s.status='scheduled'
            AND s.scheduled_start_at >= NOW()
            AND s.scheduled_start_at < NOW() + INTERVAL '7 days'
        ) AS upcoming_this_week
      FROM assigned
    `,
    [id]
  );

  const row = result.rows[0];
  return res.status(200).json({
    success: true,
    dashboard: {
      needsAttention: Number(row.needs_attention),
      readyForCounsellor: Number(row.ready_for_counsellor),
      activeEngagements: Number(row.active_engagements),
      waitingForApproval: Number(row.waiting_for_approval),
      sessionsToday: Number(row.sessions_today),
      upcomingThisWeek: Number(row.upcoming_this_week),
    },
  });
}));

router.get("/requests", validateQuery(counsellorRequestListQuerySchema), asyncHandler(async (req, res) => {
  const filters = req.validatedQuery;
  const conditions = ["sr.assigned_counsellor_id = $1"];
  const values = [req.user.id];

  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(`(
      sr.request_number ILIKE $${values.length}
      OR request_user.full_name ILIKE $${values.length}
      OR request_user.email ILIKE $${values.length}
      OR sr.title ILIKE $${values.length}
    )`);
  }

  const queue = queueCondition(filters.queue);
  if (queue) conditions.push(queue);

  const where = `WHERE ${conditions.join(" AND ")}`;
  const sortMap = { updatedAt: "sr.updated_at", createdAt: "sr.created_at", requestNumber: "sr.request_number" };
  const direction = filters.sortDirection.toUpperCase();

  const countResult = await pool.query(
    `
      SELECT COUNT(*) AS total_items
      FROM service_requests sr
      INNER JOIN users request_user ON request_user.id = sr.user_id
      LEFT JOIN service_entitlements se ON se.request_id = sr.id
      ${where}
    `,
    values
  );
  const totalItems = Number(countResult.rows[0].total_items);

  values.push(filters.pageSize);
  const limitIndex = values.length;
  values.push((filters.page - 1) * filters.pageSize);
  const offsetIndex = values.length;

  const result = await pool.query(
    `
      ${counsellorRequestSelect}
      ${where}
      ORDER BY ${sortMap[filters.sortBy]} ${direction}, sr.id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `,
    values
  );

  return res.status(200).json({
    success: true,
    filters,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / filters.pageSize)),
    },
    requests: result.rows.map(mapCounsellorRequest),
  });
}));

router.get("/requests/:requestId", validateParams(requestIdParamsSchema), asyncHandler(async (req, res) => {
  const result = await pool.query(
    `${counsellorRequestSelect} WHERE sr.id = $1 AND sr.assigned_counsellor_id = $2`,
    [req.validatedParams.requestId, req.user.id]
  );

  if (!result.rowCount) return res.status(404).json({ success: false, message: "Assigned request not found." });
  return res.status(200).json({ success: true, request: mapCounsellorRequest(result.rows[0]) });
}));

function mapSession(record) {
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
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function mapProposal(record, options) {
  return {
    id: record.id,
    requestId: record.request_id,
    counsellorId: record.counsellor_id,
    message: record.message,
    status: record.status,
    selectedOptionId: record.selected_option_id,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    options,
  };
}

router.post(
  "/requests/:requestId/preferred-slots/:slotId/accept",
  validateParams(acceptSlotParamsSchema),
  validateRequest(acceptPreferredSlotSchema),
  asyncHandler(async (req, res) => {
    const { requestId, slotId } = req.validatedParams;
    const { meetingProvider, meetingLink } = req.validatedBody;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `SELECT
          sr.*,
          request_user.full_name AS user_full_name,
          request_user.email AS user_email,
          counsellor.full_name AS counsellor_full_name,
          counsellor.email AS counsellor_email,
          ps.id AS preferred_slot_id,
          ps.scheduled_start_at,
          ps.scheduled_end_at,
          ps.timezone AS slot_timezone
         FROM service_requests sr
         INNER JOIN users request_user ON request_user.id=sr.user_id
         INNER JOIN users counsellor ON counsellor.id=sr.assigned_counsellor_id
         INNER JOIN service_request_preferred_slots ps ON ps.request_id=sr.id
         WHERE sr.id=$1
           AND sr.assigned_counsellor_id=$2
           AND ps.id=$3
         FOR UPDATE`,
        [requestId, req.user.id, slotId]
      );

      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Preferred slot not found." });
      }

      const request = result.rows[0];
      const deliveryState = await getDeliveryState(requestId, { dbClient: client, forUpdate: true });
      const permission = canScheduleForEngagement(deliveryState);
      if (!permission.allowed) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: permission.reason });
      }

      const startTime = new Date(request.scheduled_start_at);
      const endTime = new Date(request.scheduled_end_at);
      const availability = await assertCounsellorAvailable({
        counsellorId: req.user.id,
        startAt: startTime,
        endAt: endTime,
        dbClient: client,
      });

      if (!availability.allowed) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: availability.reason });
      }

      const conflictResult = await client.query(
        `SELECT id FROM sessions
         WHERE counsellor_id=$1
           AND status='scheduled'
           AND scheduled_start_at<$3
           AND scheduled_end_at>$2
         FOR UPDATE`,
        [req.user.id, startTime.toISOString(), endTime.toISOString()]
      );

      if (conflictResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "You already have another scheduled session during this time.",
        });
      }

      const sessionResult = await client.query(
        `INSERT INTO sessions(
          request_id, user_id, counsellor_id, title, scheduled_start_at,
          scheduled_end_at, timezone, meeting_provider, meeting_link,
          meeting_link_updated_at, status
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,
          CASE WHEN $9::text IS NULL THEN NULL ELSE NOW() END,
          'scheduled')
        RETURNING *`,
        [
          requestId,
          request.user_id,
          req.user.id,
          `${request.request_number} - Session`,
          startTime.toISOString(),
          endTime.toISOString(),
          request.slot_timezone,
          meetingProvider,
          meetingLink || null,
        ]
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
        action: "USER_PREFERRED_SLOT_ACCEPTED",
        entityType: "service_request_preferred_slot",
        entityId: slotId,
        requestId,
        newValues: {
          scheduledStartAt: startTime.toISOString(),
          scheduledEndAt: endTime.toISOString(),
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        dbClient: client,
      });

      await client.query("COMMIT");

      await notifyUser({
        userId: request.user_id,
        userEmail: request.user_email,
        requestId,
        sessionId: sessionResult.rows[0].id,
        notificationType: "session_scheduled",
        title: "Your CareerConnect session has been scheduled",
        message: `Your counsellor accepted a preferred slot for ${request.request_number}.`,
        actionUrl: `/app/workspace?requestId=${requestId}`,
        emailSubject: `Session scheduled: ${request.request_number}`,
        emailText: `Hello ${request.user_full_name},\n\nYour counsellor accepted one of your preferred session times. Log in to CareerConnect to review the session details.`,
      });

      return res.status(201).json({
        success: true,
        message: "Preferred slot accepted and session scheduled.",
        schedulingStatus: "confirmed",
        session: mapSession({
          ...sessionResult.rows[0],
          request_number: request.request_number,
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

router.post(
  "/requests/:requestId/slot-proposals",
  validateParams(requestIdParamsSchema),
  validateRequest(proposeAlternateSlotsSchema),
  asyncHandler(async (req, res) => {
    const { requestId } = req.validatedParams;
    const { message, slots } = req.validatedBody;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const requestResult = await client.query(
        `SELECT
          sr.id,
          sr.request_number,
          sr.user_id,
          sr.assigned_counsellor_id,
          request_user.full_name AS user_full_name,
          request_user.email AS user_email
         FROM service_requests sr
         INNER JOIN users request_user ON request_user.id=sr.user_id
         WHERE sr.id=$1 AND sr.assigned_counsellor_id=$2
         FOR UPDATE`,
        [requestId, req.user.id]
      );

      if (!requestResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Assigned request not found." });
      }

      const deliveryState = await getDeliveryState(requestId, { dbClient: client, forUpdate: true });
      const permission = canScheduleForEngagement(deliveryState);
      if (!permission.allowed) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: permission.reason });
      }

      for (const slot of slots) {
        const startTime = new Date(slot.scheduledStartAt);
        const endTime = new Date(slot.scheduledEndAt);
        const availability = await assertCounsellorAvailable({
          counsellorId: req.user.id,
          startAt: startTime,
          endAt: endTime,
          dbClient: client,
        });

        if (!availability.allowed) {
          await client.query("ROLLBACK");
          return res.status(409).json({ success: false, message: availability.reason });
        }

        const conflictResult = await client.query(
          `SELECT id FROM sessions
           WHERE counsellor_id=$1
             AND status='scheduled'
             AND scheduled_start_at<$3
             AND scheduled_end_at>$2
           FOR UPDATE`,
          [req.user.id, startTime.toISOString(), endTime.toISOString()]
        );

        if (conflictResult.rowCount) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            success: false,
            message: "One proposed slot overlaps an existing scheduled session.",
          });
        }
      }

      await client.query(
        "UPDATE session_slot_proposals SET status='expired', updated_at=NOW() WHERE request_id=$1 AND status='proposed'",
        [requestId]
      );

      const proposalResult = await client.query(
        `INSERT INTO session_slot_proposals(request_id, counsellor_id, message)
         VALUES($1,$2,$3)
         RETURNING *`,
        [requestId, req.user.id, message || null]
      );

      const options = [];
      for (const [index, slot] of slots.entries()) {
        const optionResult = await client.query(
          `INSERT INTO session_slot_proposal_options(
            proposal_id, scheduled_start_at, scheduled_end_at, timezone, display_order
          )
          VALUES($1,$2,$3,$4,$5)
          RETURNING *`,
          [
            proposalResult.rows[0].id,
            slot.scheduledStartAt,
            slot.scheduledEndAt,
            slot.timezone,
            index + 1,
          ]
        );

        options.push({
          id: optionResult.rows[0].id,
          scheduledStartAt: optionResult.rows[0].scheduled_start_at,
          scheduledEndAt: optionResult.rows[0].scheduled_end_at,
          timezone: optionResult.rows[0].timezone,
          displayOrder: optionResult.rows[0].display_order,
          status: optionResult.rows[0].status,
          source: "counsellor_alternative",
        });
      }

      await client.query(
        `UPDATE service_requests
         SET scheduling_status='alternative_slots_proposed',
             scheduling_status_updated_at=NOW()
         WHERE id=$1`,
        [requestId]
      );

      await createAuditLog({
        actorUserId: req.user.id,
        action: "ALTERNATE_SESSION_SLOTS_PROPOSED",
        entityType: "session_slot_proposal",
        entityId: proposalResult.rows[0].id,
        requestId,
        newValues: { optionCount: options.length },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        dbClient: client,
      });

      await client.query("COMMIT");

      const request = requestResult.rows[0];
      await notifyUser({
        userId: request.user_id,
        userEmail: request.user_email,
        requestId,
        notificationType: "session_alternatives_proposed",
        title: "Your counsellor proposed alternate session times",
        message: `Review proposed session options for ${request.request_number}.`,
        actionUrl: `/app/workspace?requestId=${requestId}`,
        emailSubject: `Session options proposed: ${request.request_number}`,
        emailText: `Hello ${request.user_full_name},\n\nYour counsellor proposed alternate session options. Log in to CareerConnect to choose one.`,
      });

      return res.status(201).json({
        success: true,
        message: "Alternate session options sent to the user.",
        schedulingStatus: "alternative_slots_proposed",
        proposal: mapProposal(proposalResult.rows[0], options),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
