const express = require("express");
const { z } = require("zod");

const { pool } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");
const { authenticateToken } = require("../middleware/authMiddleware");
const { validateParams } = require("../middleware/validateParams");

const router = express.Router();

const notificationIdParamsSchema = z
  .object({
    notificationId: z.string().uuid("Notification ID must be a valid UUID."),
  })
  .strict();

function mapNotificationRecord(record) {
  return {
    id: record.id,
    requestId: record.request_id,
    sessionId: record.session_id,
    notificationType: record.notification_type,
    title: record.title,
    message: record.message,
    actionUrl: record.action_url,
    isRead: record.is_read,
    readAt: record.read_at,
    createdAt: record.created_at,
  };
}

router.get(
  "/",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const notificationsResult = await pool.query(
      `
        SELECT
          id,
          request_id,
          session_id,
          notification_type,
          title,
          message,
          action_url,
          is_read,
          read_at,
          created_at
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 100
      `,
      [req.user.id]
    );

    const unreadCountResult = await pool.query(
      `
        SELECT COUNT(*) AS unread_count
        FROM notifications
        WHERE user_id = $1
          AND is_read = false
      `,
      [req.user.id]
    );

    res.status(200).json({
      success: true,
      unreadCount: Number(unreadCountResult.rows[0].unread_count),
      notifications: notificationsResult.rows.map(mapNotificationRecord),
    });
  })
);

router.patch(
  "/:notificationId/read",
  authenticateToken,
  validateParams(notificationIdParamsSchema),
  asyncHandler(async (req, res) => {
    const { notificationId } = req.validatedParams;

    const result = await pool.query(
      `
        UPDATE notifications
        SET
          is_read = true,
          read_at = COALESCE(read_at, NOW())
        WHERE id = $1
          AND user_id = $2
        RETURNING
          id,
          request_id,
          session_id,
          notification_type,
          title,
          message,
          action_url,
          is_read,
          read_at,
          created_at
      `,
      [notificationId, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    return res.status(200).json({
      success: true,
      notification: mapNotificationRecord(result.rows[0]),
    });
  })
);

router.patch(
  "/read-all",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `
        UPDATE notifications
        SET
          is_read = true,
          read_at = COALESCE(read_at, NOW())
        WHERE user_id = $1
          AND is_read = false
      `,
      [req.user.id]
    );

    return res.status(200).json({
      success: true,
      message: "All notifications have been marked as read.",
      updatedCount: result.rowCount,
    });
  })
);

module.exports = router;