const { pool } = require("../db/pool");

const FINAL_REQUEST_STATUSES = new Set([
  "completed",
  "cancelled",
  "closed",
]);

function buildDeliveryState(record) {
  const sessionsGranted = Number(record.sessions_granted || 0);
  const sessionsConsumed = Number(record.sessions_consumed || 0);
  const sessionsRemaining = Math.max(
    0,
    sessionsGranted - sessionsConsumed
  );

  const isLocked = Boolean(record.is_locked);
  const isFinalStatus = FINAL_REQUEST_STATUSES.has(record.request_status);

  let readOnlyMessage = null;

  if (isLocked) {
    readOnlyMessage =
      record.lock_reason ||
      "This engagement is locked. Only an administrator can reopen or extend it.";
  } else if (isFinalStatus) {
    readOnlyMessage = `This ${record.request_status} engagement is read-only.`;
  } else if (sessionsRemaining <= 0) {
    readOnlyMessage =
      "No sessions are currently approved. An administrator must grant or extend the session entitlement.";
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

    canSendMessages: !isLocked && !isFinalStatus,
    canScheduleSessions:
      !isLocked && !isFinalStatus && sessionsRemaining > 0,
    canManageSessions: !isLocked && !isFinalStatus,

    readOnlyMessage,
  };
}

async function getSessionAccess(sessionId, user) {
  const result = await pool.query(
    `
      SELECT
        s.id,
        s.request_id,
        s.user_id,
        s.counsellor_id,
        s.status,
        s.title,
        s.scheduled_start_at,
        s.scheduled_end_at,
        s.timezone,
        s.meeting_provider,
        s.meeting_link,

        sr.request_number,
        sr.status AS request_status,
        sr.is_locked,
        sr.locked_at,
        sr.locked_by,
        sr.lock_reason,

        COALESCE(se.sessions_granted, 0) AS sessions_granted,
        COALESCE(se.sessions_consumed, 0) AS sessions_consumed,
        COALESCE(se.status, 'inactive') AS entitlement_status,

        request_user.full_name AS user_full_name,
        request_user.email AS user_email,

        counsellor.full_name AS counsellor_full_name,
        counsellor.email AS counsellor_email

      FROM sessions s
      INNER JOIN service_requests sr
        ON sr.id = s.request_id
      INNER JOIN users request_user
        ON request_user.id = s.user_id
      INNER JOIN users counsellor
        ON counsellor.id = s.counsellor_id
      LEFT JOIN service_entitlements se
        ON se.request_id = sr.id
      WHERE s.id = $1
    `,
    [sessionId]
  );

  if (result.rowCount === 0) {
    return {
      exists: false,
      allowed: false,
      session: null,
      deliveryState: null,
    };
  }

  const session = result.rows[0];

  const isUser =
    user.role === "user" &&
    session.user_id === user.id;

  const isCounsellor =
    user.role === "counsellor" &&
    session.counsellor_id === user.id;

  const isAdmin = user.role === "admin";

  return {
    exists: true,
    allowed: isUser || isCounsellor || isAdmin,
    isUser,
    isCounsellor,
    isAdmin,
    session,
    deliveryState: buildDeliveryState(session),
  };
}

module.exports = {
  getSessionAccess,
};