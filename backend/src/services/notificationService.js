const { pool } = require("../db/pool");
const { sendEmail } = require("./emailService");
const { emitToUser } = require("../socket/socketServer");

async function createNotification({
  userId,
  requestId = null,
  sessionId = null,
  notificationType,
  title,
  message,
  actionUrl = null,
  dbClient = pool,
}) {
  const result = await dbClient.query(
    `
      INSERT INTO notifications (
        user_id,
        request_id,
        session_id,
        notification_type,
        title,
        message,
        action_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      userId,
      requestId,
      sessionId,
      notificationType,
      title,
      message,
      actionUrl,
    ]
  );

  const notification = result.rows[0];

  emitToUser(userId, "notification:new", {
    id: notification.id,
    requestId: notification.request_id,
    sessionId: notification.session_id,
    notificationType: notification.notification_type,
    title: notification.title,
    message: notification.message,
    actionUrl: notification.action_url,
    isRead: notification.is_read,
    readAt: notification.read_at,
    createdAt: notification.created_at,
  });

  return notification;
}

async function notifyUser({
  userId,
  userEmail,
  requestId = null,
  sessionId = null,
  notificationType,
  title,
  message,
  actionUrl = null,
  emailSubject = null,
  emailText = null,
  dbClient = pool,
}) {
  const notification = await createNotification({
    userId,
    requestId,
    sessionId,
    notificationType,
    title,
    message,
    actionUrl,
    dbClient,
  });

  if (!userEmail) {
    return notification;
  }

  try {
    await sendEmail({
      userId,
      requestId,
      sessionId,
      notificationType,
      to: userEmail,
      subject: emailSubject || title,
      text: emailText || message,
    });
  } catch (error) {
    console.error("Unable to send notification email:", {
      userId,
      requestId,
      notificationType,
      message: error.message,
    });
  }

  return notification;
}

module.exports = {
  createNotification,
  notifyUser,
};