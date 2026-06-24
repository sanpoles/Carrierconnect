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
  const isFinalStatus = FINAL_REQUEST_STATUSES.has(record.status);

  let readOnlyMessage = null;

  if (isLocked) {
    readOnlyMessage =
      record.lock_reason ||
      "This engagement is locked. Only an administrator can reopen or extend it.";
  } else if (isFinalStatus) {
    readOnlyMessage = `This ${record.status} engagement is read-only.`;
  } else if (sessionsRemaining <= 0) {
    readOnlyMessage =
      "No sessions are currently approved. An administrator must grant or extend the session entitlement before another session can be scheduled.";
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

async function getRequestAccess(requestId, user) {
  const result = await pool.query(
    `
      SELECT
        sr.id,
        sr.request_number,
        sr.user_id,
        sr.assigned_counsellor_id,
        sr.status,
        sr.is_locked,
        sr.locked_at,
        sr.locked_by,
        sr.lock_reason,

        request_user.full_name AS request_user_full_name,
        request_user.email AS request_user_email,

        counsellor.full_name AS counsellor_full_name,
        counsellor.email AS counsellor_email,

        COALESCE(se.sessions_granted, 0) AS sessions_granted,
        COALESCE(se.sessions_consumed, 0) AS sessions_consumed,
        COALESCE(se.status, 'inactive') AS entitlement_status

      FROM service_requests sr
      INNER JOIN users request_user
        ON request_user.id = sr.user_id
      LEFT JOIN users counsellor
        ON counsellor.id = sr.assigned_counsellor_id
      LEFT JOIN service_entitlements se
        ON se.request_id = sr.id
      WHERE sr.id = $1
    `,
    [requestId]
  );

  if (result.rowCount === 0) {
    return {
      exists: false,
      allowed: false,
      request: null,
      deliveryState: null,
    };
  }

  const request = result.rows[0];

  const isOwner =
    user.role === "user" &&
    request.user_id === user.id;

  const isAssignedCounsellor =
    user.role === "counsellor" &&
    request.assigned_counsellor_id === user.id;

  const isAdmin = user.role === "admin";

  const deliveryState = buildDeliveryState(request);

  return {
    exists: true,
    allowed: isOwner || isAssignedCounsellor || isAdmin,
    isOwner,
    isAssignedCounsellor,
    isAdmin,
    request,
    deliveryState,
  };
}

function getSenderType(role) {
  if (role === "user") {
    return "user";
  }

  if (role === "counsellor") {
    return "counsellor";
  }

  if (role === "admin") {
    return "admin";
  }

  return "system";
}

module.exports = {
  getRequestAccess,
  getSenderType,
  buildDeliveryState,
};