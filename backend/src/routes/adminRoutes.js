const express = require("express");
const { z } = require("zod");

const { pool } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");
const { authenticateToken, requireRoles } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const { validateParams } = require("../middleware/validateParams");
const { validateQuery } = require("../middleware/validateQuery");
const { createAuditLog } = require("../services/auditService");
const { notifyUser } = require("../services/notificationService");
const {
  getDeliveryState,
  setEntitlement,
  lockEngagement,
  reopenEngagement,
} = require("../services/entitlementService");

const router = express.Router();
router.use(authenticateToken);
router.use(requireRoles("admin"));

const requestStatuses = ["submitted", "assigned", "in_progress", "session_scheduled", "completed", "cancelled", "closed"];
const sessionStatuses = ["scheduled", "reschedule_requested", "cancelled", "completed", "no_show"];

const requestIdParamsSchema = z.object({ requestId: z.string().uuid("Request ID must be a valid UUID.") }).strict();

const assignCounsellorSchema = z.object({
  counsellorId: z.string().uuid("Counsellor ID must be a valid UUID."),
  futureSessionAction: z.enum(["transfer", "cancel"]).optional().default("transfer"),
  reason: z.string().trim().min(5, "Reason must contain at least 5 characters.").max(1000, "Reason cannot exceed 1,000 characters.").optional().or(z.literal("")),
}).strict();

const setEntitlementSchema = z.object({
  sessionsGranted: z.number().int("Session entitlement must be a whole number.").min(0, "Session entitlement cannot be negative.").max(100, "Session entitlement cannot exceed 100."),
  reason: z.string().trim().min(5, "Reason must contain at least 5 characters.").max(1000, "Reason cannot exceed 1,000 characters."),
}).strict();


const activateEngagementSchema = z.object({
  counsellorId: z.string().uuid("Counsellor ID must be a valid UUID.").nullable().optional(),
  sessionsGranted: z.number().int("Session entitlement must be a whole number.").min(0, "Session entitlement cannot be negative.").max(100, "Session entitlement cannot exceed 100.").optional(),
  reason: z.string().trim().min(5, "Reason must contain at least 5 characters.").max(1000, "Reason cannot exceed 1,000 characters."),
}).strict();

const reasonSchema = z.object({
  reason: z.string().trim().min(5, "Reason must contain at least 5 characters.").max(1000, "Reason cannot exceed 1,000 characters."),
}).strict();

const requestListQuerySchema = z.object({
  status: z.enum(requestStatuses).optional(),
  requestType: z.enum(["career_counselling", "mock_interview"]).optional(),
  assigned: z.enum(["true", "false"]).optional(),
  locked: z.enum(["true", "false"]).optional(),
  entitlementStatus: z.enum(["inactive", "active", "exhausted", "revoked"]).optional(),
  operationalState: z.enum(["awaiting_assignment", "awaiting_entitlement", "ready_to_start", "active", "exhausted", "locked", "closed", "cancelled"]).optional(),
  counsellorId: z.string().uuid("counsellorId must be a valid UUID.").optional(),
  userId: z.string().uuid("userId must be a valid UUID.").optional(),
  search: z.string().trim().max(200, "search cannot exceed 200 characters.").optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must use YYYY-MM-DD.").optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must use YYYY-MM-DD.").optional(),
  year: z.string().regex(/^\d{4}$/, "year must use YYYY.").transform(Number).optional(),
  month: z.string().regex(/^(?:[1-9]|1[0-2])$/, "month must be between 1 and 12.").transform(Number).optional(),
  page: z.string().regex(/^\d+$/, "page must be a number.").transform(Number).refine((value) => value >= 1, { message: "page must be at least 1." }).optional().default(1),
  pageSize: z.string().regex(/^\d+$/, "pageSize must be a number.").transform(Number).refine((value) => value >= 1 && value <= 100, { message: "pageSize must be between 1 and 100." }).optional().default(25),
  sortBy: z.enum(["createdAt", "updatedAt", "submittedAt", "status", "sessionsRemaining"]).optional().default("createdAt"),
  sortDirection: z.enum(["asc", "desc"]).optional().default("desc"),
}).strict().refine((data) => !data.startDate || !data.endDate || data.startDate <= data.endDate, { message: "startDate must be before or equal to endDate.", path: ["endDate"] });

const sessionListQuerySchema = z.object({
  status: z.enum(sessionStatuses).optional(),
  counsellorId: z.string().uuid("counsellorId must be a valid UUID.").optional(),
  userId: z.string().uuid("userId must be a valid UUID.").optional(),
  requestId: z.string().uuid("requestId must be a valid UUID.").optional(),
  search: z.string().trim().max(200, "search cannot exceed 200 characters.").optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must use YYYY-MM-DD.").optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must use YYYY-MM-DD.").optional(),
  year: z.string().regex(/^\d{4}$/, "year must use YYYY.").transform(Number).optional(),
  month: z.string().regex(/^(?:[1-9]|1[0-2])$/, "month must be between 1 and 12.").transform(Number).optional(),
  page: z.string().regex(/^\d+$/, "page must be a number.").transform(Number).refine((value) => value >= 1, { message: "page must be at least 1." }).optional().default(1),
  pageSize: z.string().regex(/^\d+$/, "pageSize must be a number.").transform(Number).refine((value) => value >= 1 && value <= 100, { message: "pageSize must be between 1 and 100." }).optional().default(25),
  sortBy: z.enum(["scheduledStartAt", "createdAt", "updatedAt", "status"]).optional().default("scheduledStartAt"),
  sortDirection: z.enum(["asc", "desc"]).optional().default("desc"),
}).strict().refine((data) => !data.startDate || !data.endDate || data.startDate <= data.endDate, { message: "startDate must be before or equal to endDate.", path: ["endDate"] });

function mapDeliveryState(record) {
  const sessionsGranted = Number(record.sessions_granted || 0);
  const sessionsConsumed = Number(record.sessions_consumed || 0);
  const sessionsRemaining = Math.max(0, sessionsGranted - sessionsConsumed);
  const isLocked = Boolean(record.is_locked);
  const isFinal = ["completed", "cancelled", "closed"].includes(record.status);
  let readOnlyMessage = null;
  if (isLocked) readOnlyMessage = record.lock_reason || "This engagement is locked. Only an administrator can reopen or extend it.";
  else if (isFinal) readOnlyMessage = `This ${record.status} engagement is read-only.`;
  else if (sessionsRemaining <= 0) readOnlyMessage = "No sessions are currently approved. An administrator must grant or extend the session entitlement before another session can be scheduled.";
  return { isLocked, lockedAt: record.locked_at, lockedBy: record.locked_by, lockReason: record.lock_reason, sessionsGranted, sessionsConsumed, sessionsRemaining, entitlementStatus: record.entitlement_status || "inactive", canSendMessages: !isLocked && !isFinal, canScheduleSessions: !isLocked && !isFinal && sessionsRemaining > 0, canManageSessions: !isLocked && !isFinal, readOnlyMessage };
}

function mapCounsellor(record) {
  return { id: record.id, fullName: record.full_name, email: record.email, phone: record.phone, isActive: record.is_active, isAvailable: record.is_available, profile: { headline: record.headline, biography: record.biography, yearsOfExperience: record.years_of_experience, specializations: record.specializations || [], languages: record.languages || [], linkedinUrl: record.linkedin_url }, activeRequestCount: Number(record.active_request_count || 0), createdAt: record.created_at };
}

function mapAdminRequest(record) {
  return { id: record.id, requestNumber: record.request_number, requestType: record.request_type, status: record.status, title: record.title, description: record.description, industry: record.industry, currentJobTitle: record.current_job_title, yearsOfExperience: record.years_of_experience, targetRole: record.target_role, skills: record.skills || [], preferredDate: record.preferred_date, preferredTimeSlot: record.preferred_time_slot, timezone: record.timezone, user: { id: record.user_id, fullName: record.user_full_name, email: record.user_email }, assignedCounsellor: record.assigned_counsellor_id ? { id: record.assigned_counsellor_id, fullName: record.counsellor_full_name, email: record.counsellor_email } : null, submittedAt: record.submitted_at, assignedAt: record.assigned_at, completedAt: record.completed_at, cancelledAt: record.cancelled_at, cancellationReason: record.cancellation_reason, deliveryState: mapDeliveryState(record), createdAt: record.created_at, updatedAt: record.updated_at };
}

function mapAdminSession(record) {
  return { id: record.id, requestId: record.request_id, requestNumber: record.request_number, title: record.title, scheduledStartAt: record.scheduled_start_at, scheduledEndAt: record.scheduled_end_at, timezone: record.timezone, meetingProvider: record.meeting_provider, meetingLink: record.meeting_link, status: record.status, rescheduleReason: record.reschedule_reason, cancellationReason: record.cancellation_reason, cancelledAt: record.cancelled_at, completedAt: record.completed_at, user: { id: record.user_id, fullName: record.user_full_name, email: record.user_email }, counsellor: { id: record.counsellor_id, fullName: record.counsellor_full_name, email: record.counsellor_email }, createdAt: record.created_at, updatedAt: record.updated_at };
}

const requestSelectColumns = `
  SELECT
    sr.id, sr.request_number, sr.user_id, sr.assigned_counsellor_id,
    sr.request_type, sr.status, sr.title, sr.description, sr.industry,
    sr.current_job_title, sr.years_of_experience, sr.target_role, sr.skills,
    sr.preferred_date, sr.preferred_time_slot, sr.timezone, sr.submitted_at,
    sr.assigned_at, sr.completed_at, sr.cancelled_at, sr.cancellation_reason,
    sr.is_locked, sr.locked_at, sr.locked_by, sr.lock_reason,
    sr.created_at, sr.updated_at,
    COALESCE(se.sessions_granted, 0) AS sessions_granted,
    COALESCE(se.sessions_consumed, 0) AS sessions_consumed,
    COALESCE(se.status, 'inactive') AS entitlement_status,
    request_user.full_name AS user_full_name,
    request_user.email AS user_email,
    counsellor.full_name AS counsellor_full_name,
    counsellor.email AS counsellor_email
  FROM service_requests sr
  INNER JOIN users request_user ON request_user.id = sr.user_id
  LEFT JOIN users counsellor ON counsellor.id = sr.assigned_counsellor_id
  LEFT JOIN service_entitlements se ON se.request_id = sr.id
`;

const sessionSelectColumns = `
  SELECT
    s.id, s.request_id, s.user_id, s.counsellor_id, s.title,
    s.scheduled_start_at, s.scheduled_end_at, s.timezone,
    s.meeting_provider, s.meeting_link, s.status, s.reschedule_reason,
    s.cancellation_reason, s.cancelled_at, s.completed_at, s.created_at, s.updated_at,
    sr.request_number,
    request_user.full_name AS user_full_name, request_user.email AS user_email,
    counsellor.full_name AS counsellor_full_name, counsellor.email AS counsellor_email
  FROM sessions s
  INNER JOIN service_requests sr ON sr.id = s.request_id
  INNER JOIN users request_user ON request_user.id = s.user_id
  INNER JOIN users counsellor ON counsellor.id = s.counsellor_id
`;

const operationalStateSql = `
  CASE
    WHEN sr.status = 'cancelled' THEN 'cancelled'
    WHEN sr.status = 'closed' THEN 'closed'
    WHEN COALESCE(se.status, 'inactive') = 'exhausted' THEN 'exhausted'
    WHEN sr.is_locked = true OR sr.status = 'completed' THEN 'locked'
    WHEN sr.assigned_counsellor_id IS NULL THEN 'awaiting_assignment'
    WHEN COALESCE(se.sessions_granted, 0) <= COALESCE(se.sessions_consumed, 0) THEN 'awaiting_entitlement'
    WHEN sr.status = 'assigned' THEN 'ready_to_start'
    ELSE 'active'
  END
`;

function appendOperationalStateFilter(conditions, values, operationalState) {
  if (!operationalState) return;
  values.push(operationalState);
  conditions.push(`(${operationalStateSql}) = $${values.length}`);
}

function appendDateFilters(conditions, values, filters, column) {
  if (filters.startDate) { values.push(filters.startDate); conditions.push(`${column} >= $${values.length}::date`); }
  if (filters.endDate) { values.push(filters.endDate); conditions.push(`${column} < ($${values.length}::date + INTERVAL '1 day')`); }
  if (filters.year) { values.push(filters.year); conditions.push(`EXTRACT(YEAR FROM ${column}) = $${values.length}`); }
  if (filters.month) { values.push(filters.month); conditions.push(`EXTRACT(MONTH FROM ${column}) = $${values.length}`); }
}

async function getActiveCounsellor(client, counsellorId) {
  const result = await client.query(`SELECT u.id, u.full_name, u.email, u.is_active, cp.is_available FROM users u INNER JOIN counsellor_profiles cp ON cp.user_id = u.id WHERE u.id = $1 AND u.role = 'counsellor' FOR UPDATE`, [counsellorId]);
  return result.rows[0] || null;
}

router.get("/dashboard", asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'user') AS total_users,
      (SELECT COUNT(*) FROM users WHERE role = 'counsellor' AND is_active = true) AS active_counsellors,
      (SELECT COUNT(*) FROM service_requests) AS total_requests,
      (
        SELECT COUNT(*)
        FROM service_requests sr
        LEFT JOIN service_entitlements se ON se.request_id = sr.id
        WHERE (${operationalStateSql}) = 'awaiting_assignment'
      ) AS awaiting_assignment,
      (
        SELECT COUNT(*)
        FROM service_requests sr
        LEFT JOIN service_entitlements se ON se.request_id = sr.id
        WHERE (${operationalStateSql}) = 'awaiting_entitlement'
      ) AS awaiting_entitlement,
      (
        SELECT COUNT(*)
        FROM service_requests sr
        LEFT JOIN service_entitlements se ON se.request_id = sr.id
        WHERE (${operationalStateSql}) = 'ready_to_start'
      ) AS ready_to_start,
      (
        SELECT COUNT(*)
        FROM service_requests sr
        LEFT JOIN service_entitlements se ON se.request_id = sr.id
        WHERE (${operationalStateSql}) = 'active'
      ) AS active_requests,
      (
        SELECT COUNT(*)
        FROM service_requests sr
        LEFT JOIN service_entitlements se ON se.request_id = sr.id
        WHERE (${operationalStateSql}) = 'exhausted'
      ) AS exhausted_entitlements,
      (
        SELECT COUNT(*)
        FROM service_requests sr
        LEFT JOIN service_entitlements se ON se.request_id = sr.id
        WHERE (${operationalStateSql}) IN ('locked', 'closed', 'cancelled')
      ) AS completed_requests,
      (SELECT COUNT(*) FROM sessions WHERE status = 'scheduled' AND scheduled_start_at >= NOW()) AS upcoming_sessions
  `);

  const stats = result.rows[0];
  return res.status(200).json({
    success: true,
    dashboard: {
      totalUsers: Number(stats.total_users),
      activeCounsellors: Number(stats.active_counsellors),
      totalRequests: Number(stats.total_requests),
      unassignedRequests: Number(stats.awaiting_assignment),
      awaitingEntitlementApproval: Number(stats.awaiting_entitlement),
      readyToStartRequests: Number(stats.ready_to_start),
      activeRequests: Number(stats.active_requests),
      completedRequests: Number(stats.completed_requests),
      upcomingSessions: Number(stats.upcoming_sessions),
      exhaustedEntitlements: Number(stats.exhausted_entitlements),
    },
  });
}));

router.get("/counsellors", validateQuery(z.object({ search: z.string().trim().max(200).optional(), available: z.enum(["true","false"]).optional(), page: z.string().regex(/^\d+$/).transform(Number).optional().default(1), pageSize: z.string().regex(/^\d+$/).transform(Number).refine((v) => v >= 1 && v <= 100).optional().default(25) }).strict()), asyncHandler(async (req, res) => {
  const { search, available, page, pageSize } = req.validatedQuery;
  const conditions = ["u.role = 'counsellor'", "u.is_active = true"];
  const values = [];
  if (search) { values.push(`%${search}%`); conditions.push(`(u.full_name ILIKE $${values.length} OR u.email ILIKE $${values.length})`); }
  if (available) { values.push(available === "true"); conditions.push(`cp.is_available = $${values.length}`); }
  values.push(pageSize); const limitIndex = values.length; values.push((page - 1) * pageSize); const offsetIndex = values.length;
    const countResult = await pool.query(`
    SELECT COUNT(*) AS total_items
    FROM users u INNER JOIN counsellor_profiles cp ON cp.user_id = u.id
    WHERE ${conditions.join(" AND ")}
  `, values.slice(0, -2));
  const totalItems = Number(countResult.rows[0].total_items);
  const result = await pool.query(`
    SELECT u.id, u.full_name, u.email, u.phone, u.is_active, u.created_at,
      cp.headline, cp.biography, cp.years_of_experience, cp.specializations, cp.languages, cp.linkedin_url, cp.is_available,
      (SELECT COUNT(*) FROM service_requests sr WHERE sr.assigned_counsellor_id = u.id AND sr.is_locked = false AND sr.status IN ('assigned','in_progress','session_scheduled')) AS active_request_count
    FROM users u INNER JOIN counsellor_profiles cp ON cp.user_id = u.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY cp.is_available DESC, active_request_count ASC, u.full_name ASC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `, values);
  return res.status(200).json({ success: true, filters: { search: search || null, available: available || null }, pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) }, counsellors: result.rows.map(mapCounsellor) });
}));

router.get("/requests", validateQuery(requestListQuerySchema), asyncHandler(async (req, res) => {
  const filters = req.validatedQuery;
  const conditions = [];
  const values = [];
  if (filters.status) { values.push(filters.status); conditions.push(`sr.status = $${values.length}`); }
  if (filters.requestType) { values.push(filters.requestType); conditions.push(`sr.request_type = $${values.length}`); }
  if (filters.assigned === "true") conditions.push("sr.assigned_counsellor_id IS NOT NULL");
  if (filters.assigned === "false") conditions.push("sr.assigned_counsellor_id IS NULL");
  if (filters.locked) { values.push(filters.locked === "true"); conditions.push(`sr.is_locked = $${values.length}`); }
  if (filters.entitlementStatus) { values.push(filters.entitlementStatus); conditions.push(`COALESCE(se.status, 'inactive') = $${values.length}`); }
  appendOperationalStateFilter(conditions, values, filters.operationalState);
  if (filters.counsellorId) { values.push(filters.counsellorId); conditions.push(`sr.assigned_counsellor_id = $${values.length}`); }
  if (filters.userId) { values.push(filters.userId); conditions.push(`sr.user_id = $${values.length}`); }
  if (filters.search) { values.push(`%${filters.search}%`); conditions.push(`(sr.request_number ILIKE $${values.length} OR request_user.full_name ILIKE $${values.length} OR request_user.email ILIKE $${values.length} OR COALESCE(counsellor.full_name,'') ILIKE $${values.length} OR sr.title ILIKE $${values.length})`); }
  appendDateFilters(conditions, values, filters, "sr.created_at");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sortMap = { createdAt: "sr.created_at", updatedAt: "sr.updated_at", submittedAt: "sr.submitted_at", status: "sr.status", sessionsRemaining: "(COALESCE(se.sessions_granted,0) - COALESCE(se.sessions_consumed,0))" };
  values.push(filters.pageSize); const limitIndex = values.length; values.push((filters.page - 1) * filters.pageSize); const offsetIndex = values.length;
    const countResult = await pool.query(`
    SELECT COUNT(*) AS total_items
    FROM service_requests sr
    INNER JOIN users request_user ON request_user.id = sr.user_id
    LEFT JOIN users counsellor ON counsellor.id = sr.assigned_counsellor_id
    LEFT JOIN service_entitlements se ON se.request_id = sr.id
    ${where}
  `, values.slice(0, -2));
  const totalItems = Number(countResult.rows[0].total_items);
  const result = await pool.query(`${requestSelectColumns} ${where} ORDER BY ${sortMap[filters.sortBy]} ${filters.sortDirection.toUpperCase()}, sr.id DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`, values);
  return res.status(200).json({ success: true, filters, pagination: { page: filters.page, pageSize: filters.pageSize, totalItems, totalPages: Math.ceil(totalItems / filters.pageSize) }, requests: result.rows.map(mapAdminRequest) });
}));

router.get("/requests/:requestId", validateParams(requestIdParamsSchema), asyncHandler(async (req, res) => {
  const result = await pool.query(`${requestSelectColumns} WHERE sr.id = $1`, [req.validatedParams.requestId]);
  if (!result.rowCount) return res.status(404).json({ success: false, message: "Request not found." });
  return res.status(200).json({ success: true, request: mapAdminRequest(result.rows[0]) });
}));

router.get("/requests/:requestId/entitlement-history", validateParams(requestIdParamsSchema), validateQuery(z.object({ page: z.string().regex(/^\d+$/).transform(Number).optional().default(1), pageSize: z.string().regex(/^\d+$/).transform(Number).refine((v) => v >= 1 && v <= 100).optional().default(25) }).strict()), asyncHandler(async (req, res) => {
  const { requestId } = req.validatedParams;
  const { page, pageSize } = req.validatedQuery;
  const values = [requestId, pageSize, (page - 1) * pageSize];
  const countResult = await pool.query(`SELECT COUNT(*) AS total_items FROM service_entitlement_adjustments WHERE request_id=$1`, [requestId]);
  const totalItems = Number(countResult.rows[0].total_items);
  const result = await pool.query(`SELECT sea.id, sea.adjustment_type, sea.source, sea.sessions_delta, sea.reason, sea.payment_provider, sea.payment_reference_id, sea.metadata, sea.created_at, actor.full_name AS created_by_name, s.title AS session_title FROM service_entitlement_adjustments sea LEFT JOIN users actor ON actor.id=sea.created_by_user_id LEFT JOIN sessions s ON s.id=sea.session_id WHERE sea.request_id=$1 ORDER BY sea.created_at DESC LIMIT $2 OFFSET $3`, values);
  return res.status(200).json({ success: true, pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) }, adjustments: result.rows.map((row) => ({ id: row.id, adjustmentType: row.adjustment_type, source: row.source, sessionsDelta: Number(row.sessions_delta), reason: row.reason, paymentProvider: row.payment_provider, paymentReferenceId: row.payment_reference_id, metadata: row.metadata, createdAt: row.created_at, createdByName: row.created_by_name, sessionTitle: row.session_title })) });
}));

router.patch("/requests/:requestId/assign", validateParams(requestIdParamsSchema), validateRequest(assignCounsellorSchema), asyncHandler(async (req, res) => {
  const { requestId } = req.validatedParams;
  const { counsellorId, futureSessionAction, reason } = req.validatedBody;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const requestResult = await client.query(`SELECT sr.id, sr.request_number, sr.user_id, sr.assigned_counsellor_id, sr.status, sr.is_locked, request_user.full_name AS user_full_name, request_user.email AS user_email FROM service_requests sr INNER JOIN users request_user ON request_user.id=sr.user_id WHERE sr.id=$1 FOR UPDATE`, [requestId]);
    if (!requestResult.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Request not found." }); }
    const request = requestResult.rows[0];
    if (["cancelled", "closed", "completed"].includes(request.status) || request.is_locked) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "A locked or finalised engagement must be reopened before its counsellor can be changed." }); }
    const counsellor = await getActiveCounsellor(client, counsellorId);
    if (!counsellor) { await client.query("ROLLBACK"); return res.status(400).json({ success: false, message: "The selected user is not an approved counsellor." }); }
    if (!counsellor.is_active || !counsellor.is_available) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "The selected counsellor is currently unavailable." }); }
    const previousCounsellorId = request.assigned_counsellor_id;
    if (previousCounsellorId === counsellorId) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "This counsellor is already assigned to the engagement." }); }
    const futureSessionsResult = await client.query(`SELECT id, title, status, scheduled_start_at, scheduled_end_at FROM sessions WHERE request_id=$1 AND status IN ('scheduled','reschedule_requested') AND scheduled_start_at >= NOW() FOR UPDATE`, [requestId]);
    if (futureSessionAction === "transfer" && futureSessionsResult.rowCount) {
      const conflictResult = await client.query(`SELECT future.id FROM sessions future INNER JOIN sessions existing ON existing.counsellor_id=$2 AND existing.status='scheduled' AND existing.id<>future.id AND existing.scheduled_start_at < future.scheduled_end_at AND existing.scheduled_end_at > future.scheduled_start_at WHERE future.request_id=$1 AND future.status='scheduled' AND future.scheduled_start_at >= NOW() FOR UPDATE`, [requestId, counsellorId]);
      if (conflictResult.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "The new counsellor has a schedule conflict with one or more future sessions. Choose cancel future sessions or select another counsellor." }); }
      await client.query(`UPDATE sessions SET counsellor_id=$1 WHERE request_id=$2 AND status IN ('scheduled','reschedule_requested') AND scheduled_start_at >= NOW()`, [counsellorId, requestId]);
    }
    if (futureSessionAction === "cancel" && futureSessionsResult.rowCount) {
      await client.query(`UPDATE sessions SET status='cancelled', cancellation_reason=$1, cancelled_by=$2, cancelled_at=NOW() WHERE request_id=$3 AND status IN ('scheduled','reschedule_requested') AND scheduled_start_at >= NOW()`, ["Cancelled because the engagement was reassigned to another counsellor.", req.user.id, requestId]);
    }
    const updated = await client.query(`UPDATE service_requests SET assigned_counsellor_id=$1, assigned_at=NOW(), status=CASE WHEN status='submitted' THEN 'assigned' ELSE status END WHERE id=$2 RETURNING *`, [counsellorId, requestId]);
    await createAuditLog({ actorUserId: req.user.id, action: previousCounsellorId ? "COUNSELLOR_REASSIGNED_TO_REQUEST" : "COUNSELLOR_ASSIGNED_TO_REQUEST", entityType: "service_request", entityId: requestId, requestId, oldValues: { assignedCounsellorId: previousCounsellorId, status: request.status }, newValues: { assignedCounsellorId: counsellorId, futureSessionAction, transferredOrCancelledFutureSessions: futureSessionsResult.rowCount, reason: reason || null }, ipAddress: req.ip, userAgent: req.get("user-agent"), dbClient: client });
    await client.query("COMMIT");
    if (request.user_id && request.user_email) await notifyUser({ userId: request.user_id, userEmail: request.user_email, requestId, notificationType: "request_assigned", title: "Your CareerConnect counsellor has been updated", message: `${counsellor.full_name} is now assigned to request ${request.request_number}.`, actionUrl: `/requests/${requestId}`, emailSubject: `Counsellor updated: ${request.request_number}`, emailText: `Hello ${request.user_full_name},\n\n${counsellor.full_name} is now assigned to your CareerConnect request ${request.request_number}.\n\nLog in to review the engagement.` });
    if (previousCounsellorId) {
      const oldCounsellor = await pool.query(`SELECT full_name, email FROM users WHERE id=$1`, [previousCounsellorId]);
      if (oldCounsellor.rowCount && oldCounsellor.rows[0].email) await notifyUser({ userId: previousCounsellorId, userEmail: oldCounsellor.rows[0].email, requestId, notificationType: "general", title: "A CareerConnect engagement was reassigned", message: `You no longer have write access to request ${request.request_number}.`, actionUrl: `/counsellor/requests/${requestId}`, emailSubject: `Engagement reassigned: ${request.request_number}`, emailText: `Hello ${oldCounsellor.rows[0].full_name},\n\nRequest ${request.request_number} has been reassigned. You no longer have write access to this engagement.` });
    }
    await notifyUser({ userId: counsellor.id, userEmail: counsellor.email, requestId, notificationType: "request_assigned", title: "A CareerConnect engagement has been assigned to you", message: `You are now responsible for request ${request.request_number}.`, actionUrl: `/counsellor/requests/${requestId}`, emailSubject: `Engagement assigned: ${request.request_number}`, emailText: `Hello ${counsellor.full_name},\n\nYou are now assigned to CareerConnect request ${request.request_number}.\n\nPlease log in to review the engagement.` });
    const detail = await pool.query(`${requestSelectColumns} WHERE sr.id=$1`, [requestId]);
    return res.status(200).json({ success: true, message: previousCounsellorId ? "Counsellor reassigned successfully." : "Counsellor assigned successfully.", request: mapAdminRequest(detail.rows[0]), futureSessionsAffected: futureSessionsResult.rowCount, futureSessionAction });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));


router.patch("/requests/:requestId/unassign", validateParams(requestIdParamsSchema), validateRequest(reasonSchema), asyncHandler(async (req, res) => {
  const { requestId } = req.validatedParams;
  const { reason } = req.validatedBody;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const requestResult = await client.query(`
      SELECT sr.id, sr.request_number, sr.user_id, sr.assigned_counsellor_id, sr.status, sr.is_locked,
        request_user.full_name AS user_full_name, request_user.email AS user_email
      FROM service_requests sr
      INNER JOIN users request_user ON request_user.id = sr.user_id
      WHERE sr.id = $1
      FOR UPDATE
    `, [requestId]);
    if (!requestResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Request not found." });
    }
    const request = requestResult.rows[0];
    if (!request.assigned_counsellor_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "This engagement is already awaiting counsellor assignment." });
    }
    if (request.is_locked || ["completed", "cancelled", "closed"].includes(request.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "A locked or finalised engagement must be reopened before its counsellor can be removed." });
    }
    const previousCounsellorId = request.assigned_counsellor_id;
    const currentState = await getDeliveryState(requestId, { dbClient: client, forUpdate: true });
    const cancelledSessionsResult = await client.query(`
      UPDATE sessions
      SET status = 'cancelled',
        cancellation_reason = 'Cancelled because the assigned counsellor was removed by an administrator.',
        cancelled_by = $1,
        cancelled_at = NOW()
      WHERE request_id = $2
        AND status IN ('scheduled', 'reschedule_requested')
      RETURNING id
    `, [req.user.id, requestId]);
    await client.query(`
      UPDATE service_requests
      SET assigned_counsellor_id = NULL,
        assigned_at = NULL,
        status = CASE
          WHEN status = 'session_scheduled' THEN 'in_progress'
          WHEN status = 'assigned' THEN 'submitted'
          ELSE status
        END
      WHERE id = $1
    `, [requestId]);
    await createAuditLog({
      actorUserId: req.user.id,
      action: "COUNSELLOR_UNASSIGNED_FROM_REQUEST",
      entityType: "service_request",
      entityId: requestId,
      requestId,
      oldValues: { assignedCounsellorId: previousCounsellorId, status: request.status },
      newValues: { assignedCounsellorId: null, cancelledFutureSessions: cancelledSessionsResult.rowCount, reason },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      dbClient: client,
    });
    const detail = await client.query(`${requestSelectColumns} WHERE sr.id = $1`, [requestId]);
    await client.query("COMMIT");
    const previousCounsellorResult = await pool.query(`SELECT full_name, email FROM users WHERE id = $1`, [previousCounsellorId]);
    const previousCounsellor = previousCounsellorResult.rows[0];
    if (previousCounsellor?.email) {
      await notifyUser({
        userId: previousCounsellorId,
        userEmail: previousCounsellor.email,
        requestId,
        notificationType: "general",
        title: "A CareerConnect engagement was returned to the assignment queue",
        message: `You are no longer assigned to request ${request.request_number}.`,
        actionUrl: "/counsellor/dashboard",
        emailSubject: `Engagement unassigned: ${request.request_number}`,
        emailText: `Hello ${previousCounsellor.full_name},\n\nYou are no longer assigned to CareerConnect request ${request.request_number}. Any scheduled sessions for this engagement were cancelled by an administrator.`,
      });
    }
    await notifyUser({
      userId: request.user_id,
      userEmail: request.user_email,
      requestId,
      notificationType: "request_assigned",
      title: "Your CareerConnect request is awaiting counsellor assignment",
      message: `Your assigned counsellor was removed from request ${request.request_number}. Our team will assign a new counsellor shortly.`,
      actionUrl: `/requests/${requestId}`,
      emailSubject: `Counsellor assignment update: ${request.request_number}`,
      emailText: `Hello ${request.user_full_name},\n\nYour CareerConnect request ${request.request_number} is now awaiting a new counsellor assignment.`,
    });
    return res.status(200).json({
      success: true,
      message: `Counsellor removed. The engagement is now awaiting assignment${cancelledSessionsResult.rowCount ? ` and ${cancelledSessionsResult.rowCount} scheduled session${cancelledSessionsResult.rowCount === 1 ? " was" : "s were"} cancelled.` : "."}`,
      request: mapAdminRequest(detail.rows[0]),
      cancelledFutureSessions: cancelledSessionsResult.rowCount,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.patch("/requests/:requestId/activate", validateParams(requestIdParamsSchema), validateRequest(activateEngagementSchema), asyncHandler(async (req, res) => {
  const { requestId } = req.validatedParams;
  const { counsellorId, sessionsGranted, reason } = req.validatedBody;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const requestResult = await client.query(`
      SELECT
        sr.id,
        sr.request_number,
        sr.user_id,
        sr.assigned_counsellor_id,
        sr.status,
        sr.is_locked,
        request_user.full_name AS user_full_name,
        request_user.email AS user_email
      FROM service_requests sr
      INNER JOIN users request_user ON request_user.id = sr.user_id
      WHERE sr.id = $1
      FOR UPDATE
    `, [requestId]);

    if (!requestResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Request not found." });
    }

    const request = requestResult.rows[0];
    if (request.is_locked || ["completed", "cancelled", "closed"].includes(request.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "A locked or finalised engagement must be reopened before it can be activated." });
    }

    const previousCounsellorId = request.assigned_counsellor_id;
    if (counsellorId === null && previousCounsellorId) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Use the dedicated Remove counsellor action to return an assigned engagement to the assignment queue." });
    }
    const effectiveCounsellorId = counsellorId === undefined ? previousCounsellorId : counsellorId;
    let counsellor = null;

    if (effectiveCounsellorId) {
      counsellor = await getActiveCounsellor(client, effectiveCounsellorId);
      if (!counsellor || !counsellor.is_active || !counsellor.is_available) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "The selected counsellor is not active and available." });
      }
    }

    const currentState = await getDeliveryState(requestId, { dbClient: client, forUpdate: true });
    if (!currentState) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Request entitlement was not found." });
    }

    let cancelledScheduledSessions = 0;

    if (counsellorId === null && previousCounsellorId) {
      // A session must always have a responsible counsellor. When an admin removes
      // the assignee, any scheduled or reschedule-requested sessions are cancelled
      // and the engagement returns to the Awaiting assignment queue.
      const cancelledSessionsResult = await client.query(`
        UPDATE sessions
        SET
          status = 'cancelled',
          cancellation_reason = 'Cancelled because the assigned counsellor was removed by an administrator.',
          cancelled_by = $1,
          cancelled_at = NOW()
        WHERE request_id = $2
          AND status IN ('scheduled', 'reschedule_requested')
        RETURNING id
      `, [req.user.id, requestId]);
      cancelledScheduledSessions = cancelledSessionsResult.rowCount;

      await client.query(`
        UPDATE service_requests
        SET
          assigned_counsellor_id = NULL,
          assigned_at = NULL,
          status = CASE
            WHEN status = 'session_scheduled' THEN 'in_progress'
            WHEN status = 'assigned' THEN 'submitted'
            ELSE status
          END
        WHERE id = $1
      `, [requestId]);
    } else if (effectiveCounsellorId && effectiveCounsellorId !== previousCounsellorId) {
      await client.query(`
        UPDATE service_requests
        SET
          assigned_counsellor_id = $1,
          assigned_at = NOW(),
          status = CASE WHEN status = 'submitted' THEN 'assigned' ELSE status END
        WHERE id = $2
      `, [effectiveCounsellorId, requestId]);
    }

    const requestedSessionsGranted = sessionsGranted === undefined
      ? currentState.entitlement.sessionsGranted
      : sessionsGranted;

    const entitlement = await setEntitlement({
      requestId,
      sessionsGranted: requestedSessionsGranted,
      reason,
      actorUserId: req.user.id,
      source: "admin_manual",
      metadata: {
        action: "engagement_activation_or_setup",
        previousCounsellorId,
        assignedCounsellorId: effectiveCounsellorId || null,
      },
      dbClient: client,
    });

    const deliveryState = await getDeliveryState(requestId, { dbClient: client });
    const hasAssignedCounsellor = Boolean(effectiveCounsellorId);
    const hasApprovedSessions = entitlement.sessionsRemaining > 0;
    const operationalState = !hasAssignedCounsellor
      ? "awaiting_assignment"
      : !hasApprovedSessions
        ? "awaiting_entitlement"
        : request.status === "submitted" ? "ready_to_start" : "updated";

    await createAuditLog({
      actorUserId: req.user.id,
      action: "ENGAGEMENT_SETUP_UPDATED",
      entityType: "service_request",
      entityId: requestId,
      requestId,
      oldValues: {
        assignedCounsellorId: previousCounsellorId,
        sessionsGranted: currentState.entitlement.sessionsGranted,
        status: request.status,
      },
      newValues: {
        assignedCounsellorId: effectiveCounsellorId || null,
        sessionsGranted: entitlement.sessionsGranted,
        sessionsRemaining: entitlement.sessionsRemaining,
        cancelledScheduledSessions,
        operationalState,
        reason,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      dbClient: client,
    });

    await client.query("COMMIT");

    if (counsellorId === null && previousCounsellorId) {
      const previousCounsellorResult = await pool.query(
        `SELECT full_name, email FROM users WHERE id = $1`,
        [previousCounsellorId],
      );
      const previousCounsellor = previousCounsellorResult.rows[0];
      if (previousCounsellor?.email) {
        await notifyUser({
          userId: previousCounsellorId,
          userEmail: previousCounsellor.email,
          requestId,
          notificationType: "general",
          title: "A CareerConnect engagement was returned to the assignment queue",
          message: `You are no longer assigned to request ${request.request_number}.`,
          actionUrl: "/counsellor/dashboard",
          emailSubject: `Engagement unassigned: ${request.request_number}`,
          emailText: `Hello ${previousCounsellor.full_name},

You are no longer assigned to CareerConnect request ${request.request_number}. Any scheduled sessions for this engagement were cancelled by an administrator.`,
        });
      }
    }

    if (effectiveCounsellorId && effectiveCounsellorId !== previousCounsellorId && counsellor) {
      await notifyUser({
        userId: counsellor.id,
        userEmail: counsellor.email,
        requestId,
        notificationType: "request_assigned",
        title: hasApprovedSessions ? "A CareerConnect engagement is ready to start" : "A CareerConnect engagement needs session approval",
        message: hasApprovedSessions
          ? `Request ${request.request_number} is assigned to you with ${entitlement.sessionsRemaining} approved session${entitlement.sessionsRemaining === 1 ? "" : "s"} remaining.`
          : `Request ${request.request_number} is assigned to you but is awaiting session approval.`,
        actionUrl: "/counsellor/dashboard",
        emailSubject: hasApprovedSessions ? `Engagement ready to start: ${request.request_number}` : `Engagement awaiting approval: ${request.request_number}`,
        emailText: `Hello ${counsellor.full_name},

Request ${request.request_number} is assigned to you.

Approved sessions remaining: ${entitlement.sessionsRemaining}

Log in to review the engagement.`,
      });
    }

    let userMessage = `Your CareerConnect request ${request.request_number} is being prepared by our team.`;
    if (hasAssignedCounsellor && hasApprovedSessions && counsellor) {
      userMessage = `${counsellor.full_name} has been assigned and ${entitlement.sessionsRemaining} session${entitlement.sessionsRemaining === 1 ? " is" : "s are"} approved for request ${request.request_number}.`;
    } else if (hasAssignedCounsellor && counsellor) {
      userMessage = `${counsellor.full_name} has been assigned to request ${request.request_number}. Session approval is pending.`;
    } else if (hasApprovedSessions) {
      userMessage = `${entitlement.sessionsRemaining} session${entitlement.sessionsRemaining === 1 ? " is" : "s are"} approved for request ${request.request_number}. Counsellor assignment is pending.`;
    }

    await notifyUser({
      userId: request.user_id,
      userEmail: request.user_email,
      requestId,
      notificationType: "request_assigned",
      title: hasAssignedCounsellor && hasApprovedSessions ? "Your CareerConnect engagement is ready to start" : "Your CareerConnect request has been updated",
      message: userMessage,
      actionUrl: `/requests/${requestId}`,
      emailSubject: `CareerConnect request updated: ${request.request_number}`,
      emailText: `Hello ${request.user_full_name},

${userMessage}

Log in to review updates.`,
    });

    const detail = await pool.query(`${requestSelectColumns} WHERE sr.id = $1`, [requestId]);
    const message = counsellorId === null && previousCounsellorId
      ? `Counsellor removed. The engagement is now awaiting assignment${cancelledScheduledSessions ? ` and ${cancelledScheduledSessions} scheduled session${cancelledScheduledSessions === 1 ? " was" : "s were"} cancelled.` : "."}`
      : !hasAssignedCounsellor
        ? "Engagement setup saved. It is now awaiting counsellor assignment."
      : !hasApprovedSessions
        ? "Engagement setup saved. It is now awaiting session entitlement approval."
        : "Engagement activated successfully. The counsellor can now begin work.";

    return res.status(200).json({
      success: true,
      message,
      request: mapAdminRequest(detail.rows[0]),
      deliveryState,
      operationalState,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.patch("/requests/:requestId/entitlement", validateParams(requestIdParamsSchema), validateRequest(setEntitlementSchema), asyncHandler(async (req, res) => {
  const { requestId } = req.validatedParams;
  const { sessionsGranted, reason } = req.validatedBody;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentState = await getDeliveryState(requestId, { dbClient: client, forUpdate: true });
    if (!currentState) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Request not found." }); }
    const entitlement = await setEntitlement({ requestId, sessionsGranted, reason, actorUserId: req.user.id, source: "admin_manual", metadata: { changedBy: "admin" }, dbClient: client });
    const nextState = await getDeliveryState(requestId, { dbClient: client });
    await createAuditLog({ actorUserId: req.user.id, action: "SESSION_ENTITLEMENT_UPDATED", entityType: "service_entitlement", entityId: entitlement.id, requestId, oldValues: { sessionsGranted: currentState.entitlement.sessionsGranted, sessionsConsumed: currentState.entitlement.sessionsConsumed }, newValues: { sessionsGranted: entitlement.sessionsGranted, sessionsConsumed: entitlement.sessionsConsumed, sessionsRemaining: entitlement.sessionsRemaining, status: entitlement.status, reason }, ipAddress: req.ip, userAgent: req.get("user-agent"), dbClient: client });
    await client.query("COMMIT");
    return res.status(200).json({ success: true, message: currentState.isLocked && entitlement.sessionsRemaining > 0 ? "Entitlement updated. The engagement remains locked until an administrator explicitly reopens it." : "Session entitlement updated successfully.", deliveryState: nextState });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.patch("/requests/:requestId/lock", validateParams(requestIdParamsSchema), validateRequest(reasonSchema), asyncHandler(async (req, res) => {
  const { requestId } = req.validatedParams;
  const { reason } = req.validatedBody;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await getDeliveryState(requestId, { dbClient: client, forUpdate: true });
    if (!state) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Request not found." }); }
    await lockEngagement({ requestId, actorUserId: req.user.id, reason, dbClient: client });
    await createAuditLog({ actorUserId: req.user.id, action: "ENGAGEMENT_LOCKED", entityType: "service_request", entityId: requestId, requestId, oldValues: { isLocked: state.isLocked }, newValues: { isLocked: true, reason }, ipAddress: req.ip, userAgent: req.get("user-agent"), dbClient: client });
    const deliveryState = await getDeliveryState(requestId, { dbClient: client });
    await client.query("COMMIT");
    return res.status(200).json({ success: true, message: "Engagement locked successfully.", deliveryState });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.patch("/requests/:requestId/reopen", validateParams(requestIdParamsSchema), validateRequest(reasonSchema), asyncHandler(async (req, res) => {
  const { requestId } = req.validatedParams;
  const { reason } = req.validatedBody;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const previous = await getDeliveryState(requestId, { dbClient: client, forUpdate: true });
    if (!previous) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Request not found." }); }
    const request = await reopenEngagement({ requestId, actorUserId: req.user.id, reason, dbClient: client });
    await createAuditLog({ actorUserId: req.user.id, action: "ENGAGEMENT_REOPENED", entityType: "service_request", entityId: requestId, requestId, oldValues: { isLocked: previous.isLocked, lockReason: previous.lockReason }, newValues: { isLocked: false, reason }, ipAddress: req.ip, userAgent: req.get("user-agent"), dbClient: client });
    const deliveryState = await getDeliveryState(requestId, { dbClient: client });
    await client.query("COMMIT");
    return res.status(200).json({ success: true, message: "Engagement reopened successfully.", request, deliveryState });
  } catch (error) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: error.message || "Unable to reopen engagement." }); } finally { client.release(); }
}));

router.patch("/requests/:requestId/close", validateParams(requestIdParamsSchema), validateRequest(reasonSchema), asyncHandler(async (req, res) => {
  const { requestId } = req.validatedParams;
  const { reason } = req.validatedBody;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await getDeliveryState(requestId, { dbClient: client, forUpdate: true });
    if (!state) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Request not found." }); }
    const cancelledResult = await client.query(`UPDATE sessions SET status='cancelled', cancellation_reason=$1, cancelled_by=$2, cancelled_at=NOW() WHERE request_id=$3 AND status IN ('scheduled','reschedule_requested') RETURNING id`, ["Cancelled because the engagement was closed by an administrator.", req.user.id, requestId]);
    await lockEngagement({ requestId, actorUserId: req.user.id, reason, status: "closed", dbClient: client });
    await createAuditLog({ actorUserId: req.user.id, action: "ENGAGEMENT_CLOSED", entityType: "service_request", entityId: requestId, requestId, oldValues: { status: state.requestStatus, isLocked: state.isLocked }, newValues: { status: "closed", isLocked: true, cancelledFutureSessions: cancelledResult.rowCount, reason }, ipAddress: req.ip, userAgent: req.get("user-agent"), dbClient: client });
    const deliveryState = await getDeliveryState(requestId, { dbClient: client });
    await client.query("COMMIT");
    return res.status(200).json({ success: true, message: "Engagement closed successfully.", cancelledFutureSessions: cancelledResult.rowCount, deliveryState });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.get("/sessions", validateQuery(sessionListQuerySchema), asyncHandler(async (req, res) => {
  const filters = req.validatedQuery;
  const conditions = [];
  const values = [];
  if (filters.status) { values.push(filters.status); conditions.push(`s.status=$${values.length}`); }
  if (filters.counsellorId) { values.push(filters.counsellorId); conditions.push(`s.counsellor_id=$${values.length}`); }
  if (filters.userId) { values.push(filters.userId); conditions.push(`s.user_id=$${values.length}`); }
  if (filters.requestId) { values.push(filters.requestId); conditions.push(`s.request_id=$${values.length}`); }
  if (filters.search) { values.push(`%${filters.search}%`); conditions.push(`(sr.request_number ILIKE $${values.length} OR s.title ILIKE $${values.length} OR request_user.full_name ILIKE $${values.length} OR request_user.email ILIKE $${values.length} OR counsellor.full_name ILIKE $${values.length})`); }
  appendDateFilters(conditions, values, filters, "s.scheduled_start_at");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sortMap = { scheduledStartAt: "s.scheduled_start_at", createdAt: "s.created_at", updatedAt: "s.updated_at", status: "s.status" };
  values.push(filters.pageSize); const limitIndex = values.length; values.push((filters.page - 1) * filters.pageSize); const offsetIndex = values.length;
    const countResult = await pool.query(`
    SELECT COUNT(*) AS total_items
    FROM sessions s
    INNER JOIN service_requests sr ON sr.id = s.request_id
    INNER JOIN users request_user ON request_user.id = s.user_id
    INNER JOIN users counsellor ON counsellor.id = s.counsellor_id
    ${where}
  `, values.slice(0, -2));
  const totalItems = Number(countResult.rows[0].total_items);
  const result = await pool.query(`${sessionSelectColumns} ${where} ORDER BY ${sortMap[filters.sortBy]} ${filters.sortDirection.toUpperCase()}, s.id DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`, values);
  return res.status(200).json({ success: true, filters, pagination: { page: filters.page, pageSize: filters.pageSize, totalItems, totalPages: Math.ceil(totalItems / filters.pageSize) }, sessions: result.rows.map(mapAdminSession) });
}));

module.exports = router;
