const express = require("express");
const { z } = require("zod");

const { pool } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");
const {
  authenticateToken,
  requireRoles,
} = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const { validateParams } = require("../middleware/validateParams");
const { validateQuery } = require("../middleware/validateQuery");
const { createAuditLog } = require("../services/auditService");
const { notifyUser } = require("../services/notificationService");
const { getRequestAccess } = require("../utils/requestAccess");
const { getSessionAccess } = require("../utils/sessionAccess");
const {
  getDeliveryState,
  canScheduleForEngagement,
  canManageExistingSession,
  consumeCompletedSession,
  lockEngagement,
} = require("../services/entitlementService");
const { assertCounsellorAvailable } = require("../services/availabilityService");

const router = express.Router();

// PostgreSQL accepts legacy UUID values that may not carry RFC version/variant bits.
// Validate the canonical 8-4-4-4-12 hexadecimal shape without rejecting valid existing IDs.
const uuidShape = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Request ID must be a valid UUID.");

const requestIdParamsSchema = z.object({
  requestId: uuidShape,
}).strict();

const sessionIdParamsSchema = z.object({
  sessionId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Session ID must be a valid UUID."),
}).strict();

function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z.string().trim().min(3, "Timezone is required.").max(100, "Timezone cannot exceed 100 characters.").refine(isValidTimezone, {
  message: "Timezone must be a valid IANA timezone such as Asia/Kolkata.",
});

const isoDateTimeSchema = z.string().trim().min(20, "Date/time must be a valid ISO-8601 value.").max(50, "Date/time value is too long.").refine(
  (value) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && !Number.isNaN(Date.parse(value)),
  { message: "Date/time must include a timezone offset, for example 2026-06-30T10:00:00+05:30." }
);

const scheduleSessionSchema = z.object({
  title: z.string().trim().min(5, "Session title must contain at least 5 characters.").max(250, "Session title cannot exceed 250 characters.").optional().or(z.literal("")),
  scheduledStartAt: isoDateTimeSchema,
  scheduledEndAt: isoDateTimeSchema,
  timezone: timezoneSchema.default("Asia/Kolkata"),
  meetingProvider: z.string().trim().min(2, "Meeting provider is required.").max(100, "Meeting provider cannot exceed 100 characters.").default("Zoom"),
  meetingLink: z.string().trim().url("Meeting link must be a valid URL.").max(2000, "Meeting link cannot exceed 2,000 characters.").optional().or(z.literal("")),
}).strict().refine(
  (data) => new Date(data.scheduledEndAt).getTime() > new Date(data.scheduledStartAt).getTime(),
  { message: "Session end time must be after the start time.", path: ["scheduledEndAt"] }
).refine(
  (data) => {
    const durationMinutes = (new Date(data.scheduledEndAt).getTime() - new Date(data.scheduledStartAt).getTime()) / 60000;
    return durationMinutes >= 15 && durationMinutes <= 240;
  },
  { message: "Session duration must be between 15 and 240 minutes.", path: ["scheduledEndAt"] }
);

const rescheduleRequestSchema = z.object({
  reason: z.string().trim().min(5, "Reason must contain at least 5 characters.").max(1000, "Reason cannot exceed 1,000 characters."),
}).strict();

const cancelSessionSchema = z.object({
  cancellationReason: z.string().trim().min(5, "Cancellation reason must contain at least 5 characters.").max(1000, "Cancellation reason cannot exceed 1,000 characters."),
}).strict();

const completeSessionSchema = z.object({
  completionNotes: z.string().trim().max(3000, "Completion notes cannot exceed 3,000 characters.").optional().or(z.literal("")),
}).strict();

const sessionListQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must use YYYY-MM-DD.").optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must use YYYY-MM-DD.").optional(),
  year: z.string().regex(/^\d{4}$/, "year must use YYYY.").transform(Number).optional(),
  month: z.string().regex(/^(?:[1-9]|1[0-2])$/, "month must be between 1 and 12.").transform(Number).optional(),
  status: z.enum(["scheduled", "reschedule_requested", "cancelled", "completed", "no_show"]).optional(),
  page: z.string().regex(/^\d+$/, "page must be a number.").transform(Number).refine((value) => value >= 1, { message: "page must be at least 1." }).optional().default(1),
  pageSize: z.string().regex(/^\d+$/, "pageSize must be a number.").transform(Number).refine((value) => value >= 1 && value <= 100, { message: "pageSize must be between 1 and 100." }).optional().default(25),
  sortBy: z.enum(["scheduledStartAt", "createdAt", "updatedAt", "status"]).optional().default("scheduledStartAt"),
  sortDirection: z.enum(["asc", "desc"]).optional().default("desc"),
}).strict().refine(
  (data) => !data.startDate || !data.endDate || data.startDate <= data.endDate,
  { message: "startDate must be before or equal to endDate.", path: ["endDate"] }
);

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
    meetingLinkUpdatedAt: record.meeting_link_updated_at,
    status: record.status,
    rescheduleReason: record.reschedule_reason,
    cancellationReason: record.cancellation_reason,
    cancelledAt: record.cancelled_at,
    completedAt: record.completed_at,
    reminderSentAt: record.reminder_sent_at,
    user: record.user_id ? { id: record.user_id, fullName: record.user_full_name, email: record.user_email } : null,
    counsellor: record.counsellor_id ? { id: record.counsellor_id, fullName: record.counsellor_full_name, email: record.counsellor_email } : null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

const sessionSelectColumns = `
  SELECT
    s.id, s.request_id, s.user_id, s.counsellor_id, s.title,
    s.scheduled_start_at, s.scheduled_end_at, s.timezone,
    s.meeting_provider, s.meeting_link, s.meeting_link_updated_at,
    s.status, s.reschedule_reason, s.cancellation_reason,
    s.cancelled_at, s.completed_at, s.reminder_sent_at,
    s.created_at, s.updated_at,
    sr.request_number,
    request_user.full_name AS user_full_name,
    request_user.email AS user_email,
    counsellor.full_name AS counsellor_full_name,
    counsellor.email AS counsellor_email
  FROM sessions s
  INNER JOIN service_requests sr ON sr.id = s.request_id
  INNER JOIN users request_user ON request_user.id = s.user_id
  INNER JOIN users counsellor ON counsellor.id = s.counsellor_id
`;

async function verifyRequestAccess(req, res, next) {
  const access = await getRequestAccess(req.validatedParams.requestId, req.user);
  if (!access.exists) return res.status(404).json({ success: false, message: "Request not found." });
  if (!access.allowed) return res.status(403).json({ success: false, message: "You do not have access to this request." });
  req.requestAccess = access;
  next();
}

async function verifySessionAccess(req, res, next) {
  const access = await getSessionAccess(req.validatedParams.sessionId, req.user);
  if (!access.exists) return res.status(404).json({ success: false, message: "Session not found." });
  if (!access.allowed) return res.status(403).json({ success: false, message: "You do not have access to this session." });
  req.sessionAccess = access;
  next();
}

function assertCounsellorOrAdminForRequest(request, user) {
  const isAssignedCounsellor = user.role === "counsellor" && request.assigned_counsellor_id === user.id;
  const isAdmin = user.role === "admin";
  return isAssignedCounsellor || isAdmin;
}

function addSessionDateFilters(query, values, filters, alias = "s") {
  if (filters.startDate) {
    values.push(filters.startDate);
    query.push(`${alias}.scheduled_start_at >= $${values.length}::date`);
  }
  if (filters.endDate) {
    values.push(filters.endDate);
    query.push(`${alias}.scheduled_start_at < ($${values.length}::date + INTERVAL '1 day')`);
  }
  if (filters.year) {
    values.push(filters.year);
    query.push(`EXTRACT(YEAR FROM ${alias}.scheduled_start_at) = $${values.length}`);
  }
  if (filters.month) {
    values.push(filters.month);
    query.push(`EXTRACT(MONTH FROM ${alias}.scheduled_start_at) = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    query.push(`${alias}.status = $${values.length}`);
  }
}

router.get("/requests/:requestId/sessions", authenticateToken, validateParams(requestIdParamsSchema), verifyRequestAccess, asyncHandler(async (req, res) => {
  const { requestId } = req.validatedParams;
  const [result, deliveryState] = await Promise.all([
    pool.query(`${sessionSelectColumns} WHERE s.request_id = $1 ORDER BY s.scheduled_start_at DESC`, [requestId]),
    getDeliveryState(requestId),
  ]);
  return res.status(200).json({ success: true, count: result.rowCount, sessions: result.rows.map(mapSessionRecord), deliveryState });
}));

router.post("/requests/:requestId/sessions", authenticateToken, requireRoles("counsellor", "admin"), validateParams(requestIdParamsSchema), validateRequest(scheduleSessionSchema), asyncHandler(async (req, res) => {
  const { requestId } = req.validatedParams;
  const { title, scheduledStartAt, scheduledEndAt, timezone, meetingProvider, meetingLink } = req.validatedBody;
  const requestAccess = await getRequestAccess(requestId, req.user);
  if (!requestAccess.exists) return res.status(404).json({ success: false, message: "Request not found." });
  const request = requestAccess.request;
  if (!assertCounsellorOrAdminForRequest(request, req.user)) return res.status(403).json({ success: false, message: "Only the assigned counsellor or an administrator can schedule this session." });
  if (!request.assigned_counsellor_id) return res.status(409).json({ success: false, message: "A counsellor must be assigned before a session can be scheduled." });
  const startTime = new Date(scheduledStartAt);
  const endTime = new Date(scheduledEndAt);
  if (startTime.getTime() < Date.now() - 5 * 60 * 1000) return res.status(400).json({ success: false, message: "A session cannot be scheduled in the past." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deliveryState = await getDeliveryState(requestId, { dbClient: client, forUpdate: true });
    const permission = canScheduleForEngagement(deliveryState);
    if (!permission.allowed) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: permission.reason });
    }
    const activeSessionResult = await client.query(`SELECT id FROM sessions WHERE request_id = $1 AND status IN ('scheduled', 'reschedule_requested') FOR UPDATE`, [requestId]);
    if (activeSessionResult.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "This request already has an active session. Reschedule or cancel the existing session instead." });
    }
    const availability = await assertCounsellorAvailable({ counsellorId: request.assigned_counsellor_id, startAt: startTime, endAt: endTime, dbClient: client });
    if (!availability.allowed) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: availability.reason }); }
    const conflictResult = await client.query(`SELECT id FROM sessions WHERE counsellor_id = $1 AND status = 'scheduled' AND scheduled_start_at < $3 AND scheduled_end_at > $2 FOR UPDATE`, [request.assigned_counsellor_id, startTime.toISOString(), endTime.toISOString()]);
    if (conflictResult.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "The counsellor already has another scheduled session during this time." });
    }
    const sessionTitle = title || `${request.request_number} - ${request.request_type === "mock_interview" ? "Mock Interview" : "Career Counselling"}`;
    const createdResult = await client.query(`
      INSERT INTO sessions (
        request_id, user_id, counsellor_id, title, scheduled_start_at,
        scheduled_end_at, timezone, meeting_provider, meeting_link,
        meeting_link_updated_at, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::text,
        CASE WHEN $9::text IS NULL THEN NULL ELSE NOW() END,
        'scheduled'
      ) RETURNING *
    `, [requestId, request.user_id, request.assigned_counsellor_id, sessionTitle, startTime.toISOString(), endTime.toISOString(), timezone, meetingProvider, meetingLink || null]);
    const createdSession = createdResult.rows[0];
    await client.query(`UPDATE service_requests SET status = 'session_scheduled' WHERE id = $1`, [requestId]);
    await createAuditLog({ actorUserId: req.user.id, action: "SESSION_SCHEDULED", entityType: "session", entityId: createdSession.id, requestId, newValues: { scheduledStartAt: createdSession.scheduled_start_at, scheduledEndAt: createdSession.scheduled_end_at, timezone: createdSession.timezone, meetingProvider: createdSession.meeting_provider, hasMeetingLink: Boolean(createdSession.meeting_link) }, ipAddress: req.ip, userAgent: req.get("user-agent"), dbClient: client });
    await client.query("COMMIT");
    for (const recipient of [
      { id: request.user_id, email: request.request_user_email, name: request.request_user_full_name },
      { id: request.assigned_counsellor_id, email: request.counsellor_email, name: request.counsellor_full_name },
    ]) {
      if (recipient.id && recipient.id !== req.user.id && recipient.email) {
        await notifyUser({ userId: recipient.id, userEmail: recipient.email, requestId, sessionId: createdSession.id, notificationType: "session_scheduled", title: "Your CareerConnect session has been scheduled", message: `Session scheduled for request ${request.request_number}.`, actionUrl: `/sessions/${createdSession.id}`, emailSubject: `Session scheduled: ${request.request_number}`, emailText: `Hello ${recipient.name},\n\nA CareerConnect session has been scheduled.\n\nRequest: ${request.request_number}\nStart: ${createdSession.scheduled_start_at}\nEnd: ${createdSession.scheduled_end_at}\nTimezone: ${createdSession.timezone}\nMeeting provider: ${createdSession.meeting_provider}\n${createdSession.meeting_link ? `Meeting link: ${createdSession.meeting_link}\n` : ""}\nLog in to CareerConnect for full details.` });
      }
    }
    return res.status(201).json({ success: true, message: "Session scheduled successfully.", session: mapSessionRecord({ ...createdSession, request_number: request.request_number, user_full_name: request.request_user_full_name, user_email: request.request_user_email, counsellor_full_name: request.counsellor_full_name, counsellor_email: request.counsellor_email }), deliveryState });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/sessions/my", authenticateToken, validateQuery(sessionListQuerySchema), asyncHandler(async (req, res) => {
  const filters = req.validatedQuery;
  const conditions = [];
  const values = [];
  if (req.user.role === "user") { values.push(req.user.id); conditions.push(`s.user_id = $${values.length}`); }
  else if (req.user.role === "counsellor") { values.push(req.user.id); conditions.push(`s.counsellor_id = $${values.length}`); }
  addSessionDateFilters(conditions, values, filters);
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sortMap = { scheduledStartAt: "s.scheduled_start_at", createdAt: "s.created_at", updatedAt: "s.updated_at", status: "s.status" };
  const direction = filters.sortDirection.toUpperCase();
  values.push(filters.pageSize);
  const limitIndex = values.length;
  values.push((filters.page - 1) * filters.pageSize);
  const offsetIndex = values.length;
    const countResult = await pool.query(`
    SELECT COUNT(*) AS total_items
    FROM sessions s
    INNER JOIN service_requests sr ON sr.id = s.request_id
    INNER JOIN users request_user ON request_user.id = s.user_id
    INNER JOIN users counsellor ON counsellor.id = s.counsellor_id
    ${whereClause}
  `, values.slice(0, -2));
  const totalItems = Number(countResult.rows[0].total_items);
  const result = await pool.query(`
    ${sessionSelectColumns}
    ${whereClause}
    ORDER BY ${sortMap[filters.sortBy]} ${direction}, s.id DESC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `, values);
  return res.status(200).json({ success: true, filters, pagination: { page: filters.page, pageSize: filters.pageSize, totalItems, totalPages: Math.ceil(totalItems / filters.pageSize) }, sessions: result.rows.map(mapSessionRecord) });
}));

router.patch("/sessions/:sessionId/request-reschedule", authenticateToken, validateParams(sessionIdParamsSchema), verifySessionAccess, validateRequest(rescheduleRequestSchema), asyncHandler(async (req, res) => {
  const { sessionId } = req.validatedParams;
  const { reason } = req.validatedBody;
  const session = req.sessionAccess.session;
  if (["cancelled", "completed", "no_show"].includes(session.status)) return res.status(409).json({ success: false, message: `A ${session.status} session cannot be rescheduled.` });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deliveryState = await getDeliveryState(session.request_id, { dbClient: client, forUpdate: true });
    const permission = canManageExistingSession(deliveryState, req.user.role);
    if (!permission.allowed) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: permission.reason }); }
    const result = await client.query(`UPDATE sessions SET status = 'reschedule_requested', reschedule_reason = $1 WHERE id = $2 RETURNING *`, [reason, sessionId]);
    const updatedSession = result.rows[0];
    await createAuditLog({ actorUserId: req.user.id, action: "SESSION_RESCHEDULE_REQUESTED", entityType: "session", entityId: sessionId, requestId: session.request_id, oldValues: { status: session.status }, newValues: { status: updatedSession.status, reason }, ipAddress: req.ip, userAgent: req.get("user-agent"), dbClient: client });
    await client.query("COMMIT");
    const recipient = req.user.role === "user" ? { id: session.counsellor_id, email: session.counsellor_email, name: session.counsellor_full_name } : { id: session.user_id, email: session.user_email, name: session.user_full_name };
    if (recipient.id && recipient.email) await notifyUser({ userId: recipient.id, userEmail: recipient.email, requestId: session.request_id, sessionId, notificationType: "session_rescheduled", title: "A session reschedule has been requested", message: `A reschedule request was raised for session ${session.title}.`, actionUrl: `/sessions/${sessionId}`, emailSubject: `Reschedule requested: ${session.request_number}`, emailText: `Hello ${recipient.name},\n\nA reschedule has been requested for your CareerConnect session.\n\nReason: ${reason}\n\nLog in to CareerConnect to review and update the schedule.` });
    return res.status(200).json({ success: true, message: "Reschedule request submitted successfully.", session: mapSessionRecord({ ...updatedSession, request_number: session.request_number, user_full_name: session.user_full_name, user_email: session.user_email, counsellor_full_name: session.counsellor_full_name, counsellor_email: session.counsellor_email }), deliveryState });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.patch("/sessions/:sessionId/reschedule", authenticateToken, requireRoles("counsellor", "admin"), validateParams(sessionIdParamsSchema), validateRequest(scheduleSessionSchema), asyncHandler(async (req, res) => {
  const { sessionId } = req.validatedParams;
  const { title, scheduledStartAt, scheduledEndAt, timezone, meetingProvider, meetingLink } = req.validatedBody;
  const access = await getSessionAccess(sessionId, req.user);
  if (!access.exists) return res.status(404).json({ success: false, message: "Session not found." });
  const session = access.session;
  const isAssignedCounsellor = req.user.role === "counsellor" && session.counsellor_id === req.user.id;
  if (!isAssignedCounsellor && req.user.role !== "admin") return res.status(403).json({ success: false, message: "Only the assigned counsellor or an administrator can reschedule this session." });
  if (["cancelled", "completed", "no_show"].includes(session.status)) return res.status(409).json({ success: false, message: `A ${session.status} session cannot be rescheduled.` });
  const startTime = new Date(scheduledStartAt);
  const endTime = new Date(scheduledEndAt);
  if (startTime.getTime() < Date.now() - 5 * 60 * 1000) return res.status(400).json({ success: false, message: "A session cannot be rescheduled into the past." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deliveryState = await getDeliveryState(session.request_id, { dbClient: client, forUpdate: true });
    const permission = canManageExistingSession(deliveryState, req.user.role);
    if (!permission.allowed) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: permission.reason }); }
    const availability = await assertCounsellorAvailable({ counsellorId: session.counsellor_id, startAt: startTime, endAt: endTime, dbClient: client });
    if (!availability.allowed) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: availability.reason }); }
    const conflictResult = await client.query(`SELECT id FROM sessions WHERE counsellor_id = $1 AND id <> $2 AND status = 'scheduled' AND scheduled_start_at < $4 AND scheduled_end_at > $3 FOR UPDATE`, [session.counsellor_id, sessionId, startTime.toISOString(), endTime.toISOString()]);
    if (conflictResult.rowCount > 0) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "The counsellor already has another scheduled session during this time." }); }
    const meetingLinkChanged = (session.meeting_link || null) !== (meetingLink || null);
    const result = await client.query(`UPDATE sessions SET title=$1, scheduled_start_at=$2, scheduled_end_at=$3, timezone=$4, meeting_provider=$5, meeting_link=$6, meeting_link_updated_at=CASE WHEN $7 THEN NOW() ELSE meeting_link_updated_at END, status='scheduled', reschedule_reason=NULL WHERE id=$8 RETURNING *`, [title || session.title, startTime.toISOString(), endTime.toISOString(), timezone, meetingProvider, meetingLink || null, meetingLinkChanged, sessionId]);
    const updatedSession = result.rows[0];
    await createAuditLog({ actorUserId: req.user.id, action: "SESSION_RESCHEDULED", entityType: "session", entityId: sessionId, requestId: session.request_id, oldValues: { scheduledStartAt: session.scheduled_start_at, scheduledEndAt: session.scheduled_end_at, timezone: session.timezone, meetingLink: session.meeting_link, status: session.status }, newValues: { scheduledStartAt: updatedSession.scheduled_start_at, scheduledEndAt: updatedSession.scheduled_end_at, timezone: updatedSession.timezone, meetingLink: updatedSession.meeting_link, status: updatedSession.status }, ipAddress: req.ip, userAgent: req.get("user-agent"), dbClient: client });
    await client.query("COMMIT");
    for (const recipient of [{ id: session.user_id, email: session.user_email, name: session.user_full_name }, { id: session.counsellor_id, email: session.counsellor_email, name: session.counsellor_full_name }]) {
      if (recipient.id && recipient.id !== req.user.id && recipient.email) await notifyUser({ userId: recipient.id, userEmail: recipient.email, requestId: session.request_id, sessionId, notificationType: "session_rescheduled", title: "Your CareerConnect session has been rescheduled", message: `Session ${updatedSession.title} has been rescheduled.`, actionUrl: `/sessions/${sessionId}`, emailSubject: `Session rescheduled: ${session.request_number}`, emailText: `Hello ${recipient.name},\n\nYour CareerConnect session has been rescheduled.\n\nStart: ${updatedSession.scheduled_start_at}\nEnd: ${updatedSession.scheduled_end_at}\nTimezone: ${updatedSession.timezone}\nMeeting provider: ${updatedSession.meeting_provider}\n${updatedSession.meeting_link ? `Meeting link: ${updatedSession.meeting_link}\n` : ""}` });
    }
    if (meetingLinkChanged && session.user_id && session.user_email) await notifyUser({ userId: session.user_id, userEmail: session.user_email, requestId: session.request_id, sessionId, notificationType: "meeting_link_changed", title: "Your session meeting link has changed", message: `The meeting link for session ${updatedSession.title} has been updated.`, actionUrl: `/sessions/${sessionId}`, emailSubject: `Meeting link updated: ${session.request_number}`, emailText: `Hello ${session.user_full_name},\n\nThe meeting link for your CareerConnect session has changed.\n\nNew meeting link: ${updatedSession.meeting_link || "Not provided"}\n` });
    return res.status(200).json({ success: true, message: "Session rescheduled successfully.", session: mapSessionRecord({ ...updatedSession, request_number: session.request_number, user_full_name: session.user_full_name, user_email: session.user_email, counsellor_full_name: session.counsellor_full_name, counsellor_email: session.counsellor_email }), deliveryState });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.patch("/sessions/:sessionId/cancel", authenticateToken, validateParams(sessionIdParamsSchema), verifySessionAccess, validateRequest(cancelSessionSchema), asyncHandler(async (req, res) => {
  const { sessionId } = req.validatedParams;
  const { cancellationReason } = req.validatedBody;
  const session = req.sessionAccess.session;
  if (["cancelled", "completed", "no_show"].includes(session.status)) return res.status(409).json({ success: false, message: `A ${session.status} session cannot be cancelled.` });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deliveryState = await getDeliveryState(session.request_id, { dbClient: client, forUpdate: true });
    const permission = canManageExistingSession(deliveryState, req.user.role);
    if (!permission.allowed) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: permission.reason }); }
    const result = await client.query(`UPDATE sessions SET status='cancelled', cancellation_reason=$1, cancelled_by=$2, cancelled_at=NOW() WHERE id=$3 RETURNING *`, [cancellationReason, req.user.id, sessionId]);
    const updatedSession = result.rows[0];
    await client.query(`UPDATE service_requests SET status = 'in_progress' WHERE id = $1 AND status = 'session_scheduled'`, [session.request_id]);
    await createAuditLog({ actorUserId: req.user.id, action: "SESSION_CANCELLED", entityType: "session", entityId: sessionId, requestId: session.request_id, oldValues: { status: session.status }, newValues: { status: updatedSession.status, cancellationReason }, ipAddress: req.ip, userAgent: req.get("user-agent"), dbClient: client });
    await client.query("COMMIT");
    const recipient = req.user.id === session.user_id ? { id: session.counsellor_id, email: session.counsellor_email, name: session.counsellor_full_name } : { id: session.user_id, email: session.user_email, name: session.user_full_name };
    if (recipient.id && recipient.email) await notifyUser({ userId: recipient.id, userEmail: recipient.email, requestId: session.request_id, sessionId, notificationType: "session_cancelled", title: "A CareerConnect session has been cancelled", message: `Session ${session.title} has been cancelled.`, actionUrl: `/sessions/${sessionId}`, emailSubject: `Session cancelled: ${session.request_number}`, emailText: `Hello ${recipient.name},\n\nA CareerConnect session has been cancelled.\n\nReason: ${cancellationReason}\n\nYou can log in to CareerConnect to review the request.` });
    return res.status(200).json({ success: true, message: "Session cancelled successfully.", session: mapSessionRecord({ ...updatedSession, request_number: session.request_number, user_full_name: session.user_full_name, user_email: session.user_email, counsellor_full_name: session.counsellor_full_name, counsellor_email: session.counsellor_email }), deliveryState });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.patch("/sessions/:sessionId/complete", authenticateToken, requireRoles("counsellor", "admin"), validateParams(sessionIdParamsSchema), validateRequest(completeSessionSchema), asyncHandler(async (req, res) => {
  const { sessionId } = req.validatedParams;
  const { completionNotes } = req.validatedBody;
  const access = await getSessionAccess(sessionId, req.user);
  if (!access.exists) return res.status(404).json({ success: false, message: "Session not found." });
  const session = access.session;
  const isAssignedCounsellor = req.user.role === "counsellor" && session.counsellor_id === req.user.id;
  if (!isAssignedCounsellor && req.user.role !== "admin") return res.status(403).json({ success: false, message: "Only the assigned counsellor or an administrator can complete this session." });
  if (session.status !== "scheduled") return res.status(409).json({ success: false, message: "Only a scheduled session can be marked as completed." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deliveryStateBefore = await getDeliveryState(session.request_id, { dbClient: client, forUpdate: true });
    const permission = canManageExistingSession(deliveryStateBefore, req.user.role);
    if (!permission.allowed) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: permission.reason }); }
    if (deliveryStateBefore.entitlement.sessionsRemaining <= 0) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "No approved sessions remain for this engagement." }); }
    const result = await client.query(`UPDATE sessions SET status='completed', completed_at=NOW() WHERE id=$1 AND status='scheduled' RETURNING *`, [sessionId]);
    if (result.rowCount === 0) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "This session was already changed by another action." }); }
    const completedSession = result.rows[0];
    const entitlement = await consumeCompletedSession({ requestId: session.request_id, sessionId, actorUserId: req.user.id, dbClient: client });
    let deliveryState;
    if (entitlement.sessionsRemaining <= 0) {
      await lockEngagement({ requestId: session.request_id, actorUserId: req.user.id, reason: `All ${entitlement.sessionsGranted} approved sessions have been delivered.`, status: "completed", dbClient: client });
    } else {
      await client.query(`UPDATE service_requests SET status = 'in_progress', completed_at = NULL WHERE id = $1`, [session.request_id]);
    }
    await createAuditLog({ actorUserId: req.user.id, action: "SESSION_COMPLETED", entityType: "session", entityId: sessionId, requestId: session.request_id, oldValues: { status: session.status }, newValues: { status: completedSession.status, completionNotes: completionNotes || null, sessionsGranted: entitlement.sessionsGranted, sessionsConsumed: entitlement.sessionsConsumed, sessionsRemaining: entitlement.sessionsRemaining, engagementLocked: entitlement.sessionsRemaining <= 0 }, ipAddress: req.ip, userAgent: req.get("user-agent"), dbClient: client });
    deliveryState = await getDeliveryState(session.request_id, { dbClient: client });
    await client.query("COMMIT");
    if (session.user_id && session.user_email) {
      await notifyUser({ userId: session.user_id, userEmail: session.user_email, requestId: session.request_id, sessionId, notificationType: "session_completed", title: "Your CareerConnect session was completed", message: `Session ${session.title} has been marked as completed.`, actionUrl: `/sessions/${sessionId}`, emailSubject: `Session completed: ${session.request_number}`, emailText: `Hello ${session.user_full_name},\n\nYour CareerConnect session has been marked as completed.\n\n${deliveryState.isLocked ? "All approved sessions for this engagement have been delivered. Contact the administrator if you need additional sessions." : `${deliveryState.entitlement.sessionsRemaining} approved session(s) remain for this engagement.`}` });
    }
    return res.status(200).json({ success: true, message: deliveryState.isLocked ? "Session completed. All approved sessions have been delivered and the engagement is now locked." : "Session completed successfully.", session: mapSessionRecord({ ...completedSession, request_number: session.request_number, user_full_name: session.user_full_name, user_email: session.user_email, counsellor_full_name: session.counsellor_full_name, counsellor_email: session.counsellor_email }), deliveryState });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

module.exports = router;
