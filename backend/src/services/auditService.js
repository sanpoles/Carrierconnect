const { pool } = require("../db/pool");

async function createAuditLog({
  actorUserId = null,
  action,
  entityType,
  entityId = null,
  requestId = null,
  oldValues = null,
  newValues = null,
  ipAddress = null,
  userAgent = null,
  dbClient = pool,
}) {
  await dbClient.query(
    `
      INSERT INTO audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        request_id,
        old_values,
        new_values,
        ip_address,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      actorUserId,
      action,
      entityType,
      entityId,
      requestId,
      oldValues,
      newValues,
      ipAddress,
      userAgent,
    ]
  );
}

module.exports = {
  createAuditLog,
};