const { pool } = require("../db/pool");

const FINAL_REQUEST_STATUSES = new Set([
  "completed",
  "cancelled",
  "closed",
]);

function mapEntitlement(record) {
  if (!record) {
    return {
      id: null,
      requestId: null,
      sessionsGranted: 0,
      sessionsConsumed: 0,
      sessionsRemaining: 0,
      status: "inactive",
      createdAt: null,
      updatedAt: null,
    };
  }

  const sessionsGranted = Number(record.sessions_granted || 0);
  const sessionsConsumed = Number(record.sessions_consumed || 0);
  const sessionsRemaining = Math.max(0, sessionsGranted - sessionsConsumed);

  return {
    id: record.id,
    requestId: record.request_id,
    sessionsGranted,
    sessionsConsumed,
    sessionsRemaining,
    status: record.status,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function getReadOnlyMessage({ isLocked, requestStatus, entitlement, lockReason }) {
  if (isLocked) {
    return (
      lockReason ||
      "This engagement is locked. Only an administrator can reopen or extend it."
    );
  }

  if (FINAL_REQUEST_STATUSES.has(requestStatus)) {
    return `This ${requestStatus} engagement is read-only.`;
  }

  if (entitlement.sessionsRemaining <= 0) {
    return "No sessions are currently approved. An administrator must grant or extend the session entitlement before another session can be scheduled.";
  }

  return null;
}

function buildDeliveryState(record) {
  const entitlement = mapEntitlement(record);
  const isLocked = Boolean(record.is_locked);
  const isFinalStatus = FINAL_REQUEST_STATUSES.has(record.request_status);
  const readOnlyMessage = getReadOnlyMessage({
    isLocked,
    requestStatus: record.request_status,
    entitlement,
    lockReason: record.lock_reason,
  });

  return {
    requestId: record.request_id,
    requestNumber: record.request_number,
    requestStatus: record.request_status,
    isLocked,
    lockedAt: record.locked_at,
    lockedBy: record.locked_by,
    lockReason: record.lock_reason,
    assignedCounsellorId: record.assigned_counsellor_id,
    userId: record.user_id,

    // Internal service callers use this richer object.
    entitlement,

    // API callers and frontend components use these flattened values.
    sessionsGranted: entitlement.sessionsGranted,
    sessionsConsumed: entitlement.sessionsConsumed,
    sessionsRemaining: entitlement.sessionsRemaining,
    entitlementStatus: entitlement.status,

    canSendMessages: !isLocked && !isFinalStatus,
    canScheduleSessions:
      !isLocked && !isFinalStatus && entitlement.sessionsRemaining > 0,
    canManageSessions: !isLocked && !isFinalStatus,
    readOnlyMessage,
  };
}

async function ensureEntitlementForRequest(requestId, { dbClient = pool } = {}) {
  await dbClient.query(
    `
      INSERT INTO service_entitlements (
        request_id,
        sessions_granted,
        sessions_consumed,
        status
      )
      VALUES ($1, 0, 0, 'inactive')
      ON CONFLICT (request_id) DO NOTHING
    `,
    [requestId]
  );
}

async function getDeliveryState(requestId, { dbClient = pool, forUpdate = false } = {}) {
  await ensureEntitlementForRequest(requestId, { dbClient });

  const result = await dbClient.query(
    `
      SELECT
        sr.id AS request_id,
        sr.request_number,
        sr.status AS request_status,
        sr.user_id,
        sr.assigned_counsellor_id,
        sr.is_locked,
        sr.locked_at,
        sr.locked_by,
        sr.lock_reason,
        se.id,
        se.request_id,
        se.sessions_granted,
        se.sessions_consumed,
        se.status,
        se.created_at,
        se.updated_at
      FROM service_requests sr
      INNER JOIN service_entitlements se
        ON se.request_id = sr.id
      WHERE sr.id = $1
      ${forUpdate ? "FOR UPDATE OF sr, se" : ""}
    `,
    [requestId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return buildDeliveryState(result.rows[0]);
}

function canWriteToEngagement(deliveryState, userRole) {
  if (!deliveryState) {
    return { allowed: false, reason: "Request not found." };
  }

  if (userRole === "admin") {
    return { allowed: true, reason: null };
  }

  if (!deliveryState.canSendMessages) {
    return {
      allowed: false,
      reason:
        deliveryState.readOnlyMessage ||
        "This engagement is no longer open for messages.",
    };
  }

  return { allowed: true, reason: null };
}

function canScheduleForEngagement(deliveryState) {
  if (!deliveryState) {
    return { allowed: false, reason: "Request not found." };
  }

  if (!deliveryState.canScheduleSessions) {
    return {
      allowed: false,
      reason:
        deliveryState.readOnlyMessage ||
        "A new session cannot be scheduled for this engagement.",
    };
  }

  return { allowed: true, reason: null };
}

function canManageExistingSession(deliveryState, userRole) {
  if (!deliveryState) {
    return { allowed: false, reason: "Request not found." };
  }

  if (userRole === "admin") {
    return { allowed: true, reason: null };
  }

  if (!deliveryState.canManageSessions) {
    return {
      allowed: false,
      reason:
        deliveryState.readOnlyMessage ||
        "This engagement is no longer open for session changes.",
    };
  }

  return { allowed: true, reason: null };
}

function getEntitlementStatus({ sessionsGranted, sessionsConsumed }) {
  const remaining = sessionsGranted - sessionsConsumed;
  if (sessionsGranted <= 0) return "inactive";
  if (remaining <= 0) return "exhausted";
  return "active";
}

async function setEntitlement({
  requestId,
  sessionsGranted,
  reason,
  actorUserId,
  source = "admin_manual",
  paymentProvider = null,
  paymentReferenceId = null,
  metadata = {},
  dbClient = pool,
}) {
  if (!Number.isInteger(sessionsGranted) || sessionsGranted < 0) {
    throw new Error(
      "sessionsGranted must be a whole number that is zero or greater."
    );
  }

  const deliveryState = await getDeliveryState(requestId, {
    dbClient,
    forUpdate: true,
  });

  if (!deliveryState) {
    throw new Error("Request not found.");
  }

  const entitlement = deliveryState.entitlement;

  if (sessionsGranted < entitlement.sessionsConsumed) {
    throw new Error(
      "Session entitlement cannot be lower than the number of completed sessions."
    );
  }

  const sessionsDelta = sessionsGranted - entitlement.sessionsGranted;
  const status = getEntitlementStatus({
    sessionsGranted,
    sessionsConsumed: entitlement.sessionsConsumed,
  });

  const updatedResult = await dbClient.query(
    `
      UPDATE service_entitlements
      SET sessions_granted = $1, status = $2
      WHERE id = $3
      RETURNING *
    `,
    [sessionsGranted, status, entitlement.id]
  );

  const updatedEntitlement = mapEntitlement(updatedResult.rows[0]);

  if (sessionsDelta !== 0) {
    const adjustmentType =
      sessionsDelta > 0
        ? entitlement.sessionsGranted === 0
          ? "initial_grant"
          : source === "payment"
            ? "payment_grant"
            : "manual_grant"
        : "manual_reduction";

    await dbClient.query(
      `
        INSERT INTO service_entitlement_adjustments (
          entitlement_id,
          request_id,
          adjustment_type,
          source,
          sessions_delta,
          reason,
          payment_provider,
          payment_reference_id,
          metadata,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        updatedEntitlement.id,
        requestId,
        adjustmentType,
        source,
        sessionsDelta,
        reason,
        paymentProvider,
        paymentReferenceId,
        JSON.stringify(metadata),
        actorUserId,
      ]
    );
  }

  return updatedEntitlement;
}

async function consumeCompletedSession({ requestId, sessionId, actorUserId, dbClient = pool }) {
  const deliveryState = await getDeliveryState(requestId, {
    dbClient,
    forUpdate: true,
  });

  if (!deliveryState) throw new Error("Request not found.");

  const entitlement = deliveryState.entitlement;
  if (entitlement.sessionsRemaining <= 0) {
    throw new Error("No approved sessions remain for this engagement.");
  }

  const nextConsumed = entitlement.sessionsConsumed + 1;
  const nextStatus = getEntitlementStatus({
    sessionsGranted: entitlement.sessionsGranted,
    sessionsConsumed: nextConsumed,
  });

  const updatedResult = await dbClient.query(
    `
      UPDATE service_entitlements
      SET sessions_consumed = $1, status = $2
      WHERE id = $3
      RETURNING *
    `,
    [nextConsumed, nextStatus, entitlement.id]
  );

  const updatedEntitlement = mapEntitlement(updatedResult.rows[0]);

  await dbClient.query(
    `
      INSERT INTO service_entitlement_adjustments (
        entitlement_id,
        request_id,
        session_id,
        adjustment_type,
        source,
        sessions_delta,
        reason,
        metadata,
        created_by_user_id
      )
      VALUES ($1, $2, $3, 'session_consumed', 'system', -1, $4, $5, $6)
    `,
    [
      updatedEntitlement.id,
      requestId,
      sessionId,
      "Completed session consumed one approved session.",
      JSON.stringify({
        sessionId,
        sessionsGranted: updatedEntitlement.sessionsGranted,
        sessionsConsumed: updatedEntitlement.sessionsConsumed,
        sessionsRemaining: updatedEntitlement.sessionsRemaining,
      }),
      actorUserId,
    ]
  );

  return updatedEntitlement;
}

async function lockEngagement({ requestId, actorUserId = null, reason, status = null, dbClient = pool }) {
  const result = await dbClient.query(
    `
      UPDATE service_requests
      SET
        is_locked = TRUE,
        locked_at = NOW(),
        locked_by = $1,
        lock_reason = $2,
        status = COALESCE($3, status),
        completed_at = CASE
          WHEN $3 = 'completed' THEN COALESCE(completed_at, NOW())
          ELSE completed_at
        END
      WHERE id = $4
      RETURNING *
    `,
    [actorUserId, reason, status, requestId]
  );

  return result.rows[0] || null;
}

async function reopenEngagement({ requestId, actorUserId = null, reason, dbClient = pool }) {
  const deliveryState = await getDeliveryState(requestId, {
    dbClient,
    forUpdate: true,
  });

  if (!deliveryState) throw new Error("Request not found.");

  if (deliveryState.entitlement.sessionsRemaining <= 0) {
    throw new Error(
      "At least one remaining approved session is required before reopening this engagement."
    );
  }

  const result = await dbClient.query(
    `
      UPDATE service_requests
      SET
        is_locked = FALSE,
        locked_at = NULL,
        locked_by = NULL,
        lock_reason = NULL,
        status = CASE
          WHEN status IN ('completed', 'closed') THEN 'in_progress'
          ELSE status
        END,
        completed_at = CASE
          WHEN status IN ('completed', 'closed') THEN NULL
          ELSE completed_at
        END
      WHERE id = $1
      RETURNING *
    `,
    [requestId]
  );

  return result.rows[0] || null;
}

module.exports = {
  mapEntitlement,
  ensureEntitlementForRequest,
  getDeliveryState,
  canWriteToEngagement,
  canScheduleForEngagement,
  canManageExistingSession,
  setEntitlement,
  consumeCompletedSession,
  lockEngagement,
  reopenEngagement,
};
