const express = require("express");
const { z } = require("zod");

const { pool } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");
const { authenticateToken, requireRoles } = require("../middleware/authMiddleware");
const { validateParams } = require("../middleware/validateParams");
const { validateQuery } = require("../middleware/validateQuery");

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
    sr.preferred_time_slot, sr.timezone, sr.submitted_at, sr.assigned_at,
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

module.exports = router;
