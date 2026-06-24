const express = require("express");
const { z } = require("zod");

const { pool } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");
const { authenticateToken } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const { validateParams } = require("../middleware/validateParams");
const { createAuditLog } = require("../services/auditService");
const {
  createNotification,
  notifyUser,
} = require("../services/notificationService");
const {
  emitToUser,
  emitToAllAdmins,
} = require("../socket/socketServer");
const {
  getRequestAccess,
  getSenderType,
} = require("../utils/requestAccess");
const {
  canWriteToEngagement,
  getDeliveryState,
} = require("../services/entitlementService");

const router = express.Router();

// PostgreSQL accepts legacy UUID values that may not carry RFC version/variant bits.
// Validate the canonical 8-4-4-4-12 hexadecimal shape without rejecting valid existing IDs.
const uuidShape = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Request ID must be a valid UUID.");

const requestIdParamsSchema = z
  .object({
    requestId: uuidShape,
  })
  .strict();

const createMessageSchema = z
  .object({
    messageBody: z
      .string()
      .trim()
      .min(1, "Message cannot be empty.")
      .max(5000, "Message cannot exceed 5,000 characters."),
  })
  .strict();

function mapMessageRecord(record) {
  return {
    id: record.id,
    requestId: record.request_id,
    senderType: record.sender_type,
    sender: record.sender_user_id
      ? {
          id: record.sender_user_id,
          fullName: record.sender_full_name,
          role: record.sender_role,
        }
      : null,
    messageBody: record.message_body,
    isInternal: record.is_internal,
    readAt: record.read_at,
    createdAt: record.created_at,
  };
}

async function notifyActiveAdminsAboutCounsellorActivity({
  requestId,
  requestNumber,
  requestorName,
  counsellorName,
  notificationType,
}) {
  const adminsResult = await pool.query(
    `
      SELECT id
      FROM users
      WHERE role = 'admin'
        AND is_active = true
    `,
  )

  const isInternalNote = notificationType === "counsellor_internal_note";
  const title = isInternalNote
    ? `New private counsellor note for ${requestNumber}`
    : `New counsellor message for ${requestNumber}`;
  const message = isInternalNote
    ? `${counsellorName || "A counsellor"} added a private note for ${requestorName || "a user"}.`
    : `${counsellorName || "A counsellor"} sent a message for ${requestorName || "a user"}.`;
  const targetTab = isInternalNote ? "internal_notes" : "conversation";

  await Promise.all(
    adminsResult.rows.map((admin) =>
      createNotification({
        userId: admin.id,
        requestId,
        notificationType,
        title,
        message,
        actionUrl: `/admin/overview?requestId=${requestId}&tab=${targetTab}`,
      }),
    ),
  );
}

async function verifyRequestAccess(req, res, next) {
  const { requestId } = req.validatedParams;
  const access = await getRequestAccess(requestId, req.user);

  if (!access.exists) {
    return res.status(404).json({
      success: false,
      message: "Request not found.",
    });
  }

  if (!access.allowed) {
    return res.status(403).json({
      success: false,
      message: "You do not have access to this request.",
    });
  }

  req.requestAccess = access;
  next();
}

router.get(
  "/:requestId/messages",
  authenticateToken,
  validateParams(requestIdParamsSchema),
  verifyRequestAccess,
  asyncHandler(async (req, res) => {
    const { requestId } = req.validatedParams;

    const [messagesResult, deliveryState] = await Promise.all([
      pool.query(
        `
          SELECT
            rm.id,
            rm.request_id,
            rm.sender_user_id,
            rm.sender_type,
            rm.message_body,
            rm.is_internal,
            rm.read_at,
            rm.created_at,
            sender.full_name AS sender_full_name,
            sender.role AS sender_role
          FROM request_messages rm
          LEFT JOIN users sender
            ON sender.id = rm.sender_user_id
          WHERE rm.request_id = $1
            AND rm.is_internal = false
          ORDER BY rm.created_at ASC
        `,
        [requestId]
      ),
      getDeliveryState(requestId),
    ]);

    const unreadSenderTypes =
      req.user.role === "user"
        ? ["counsellor", "admin", "system"]
        : ["user"];

    await pool.query(
      `
        UPDATE request_messages
        SET read_at = NOW()
        WHERE request_id = $1
          AND read_at IS NULL
          AND sender_type = ANY($2::message_sender_type[])
      `,
      [requestId, unreadSenderTypes]
    );

    return res.status(200).json({
      success: true,
      count: messagesResult.rowCount,
      messages: messagesResult.rows.map(mapMessageRecord),
      deliveryState,
    });
  })
);

router.post(
  "/:requestId/messages",
  authenticateToken,
  validateParams(requestIdParamsSchema),
  verifyRequestAccess,
  validateRequest(createMessageSchema),
  asyncHandler(async (req, res) => {
    const { requestId } = req.validatedParams;
    const { messageBody } = req.validatedBody;
    const request = req.requestAccess.request;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const deliveryState = await getDeliveryState(requestId, {
        dbClient: client,
        forUpdate: true,
      });

      const writePermission = canWriteToEngagement(
        deliveryState,
        req.user.role
      );

      if (!writePermission.allowed) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message: writePermission.reason,
        });
      }

      const senderType = getSenderType(req.user.role);

      const messageResult = await client.query(
        `
          INSERT INTO request_messages (
            request_id,
            sender_user_id,
            sender_type,
            message_body,
            is_internal
          )
          VALUES ($1, $2, $3, $4, false)
          RETURNING *
        `,
        [
          requestId,
          req.user.id,
          senderType,
          messageBody,
        ]
      );

      const createdMessage = messageResult.rows[0];

      if (
        req.user.role === "user" &&
        ["submitted", "assigned"].includes(request.status)
      ) {
        await client.query(
          `
            UPDATE service_requests
            SET status = 'in_progress'
            WHERE id = $1
          `,
          [requestId]
        );
      }

      await createAuditLog({
        actorUserId: req.user.id,
        action: "REQUEST_MESSAGE_SENT",
        entityType: "request_message",
        entityId: createdMessage.id,
        requestId,
        newValues: {
          senderType,
          messageLength: messageBody.length,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        dbClient: client,
      });

      await client.query("COMMIT");

      const mappedMessage = mapMessageRecord({
        ...createdMessage,
        sender_full_name: req.user.full_name,
        sender_role: req.user.role,
      });

      const recipientIds = new Set(
        [
          request.user_id,
          request.assigned_counsellor_id,
        ].filter(Boolean)
      );

      for (const userId of recipientIds) {
        emitToUser(userId, "message:new", mappedMessage);
      }

      emitToAllAdmins("message:new", mappedMessage);

      if (req.user.role === "counsellor") {
        try {
          await notifyActiveAdminsAboutCounsellorActivity({
            requestId,
            requestNumber: request.request_number,
            requestorName: request.request_user_full_name,
            counsellorName: req.user.full_name,
            notificationType: "counsellor_message",
          });
        } catch (notificationError) {
          console.error("Unable to create counsellor message alerts for admins:", {
            requestId,
            error: notificationError.message,
          });
        }
      }

      const recipient =
        req.user.role === "user"
          ? {
              id: request.assigned_counsellor_id,
              email: request.counsellor_email,
              name: request.counsellor_full_name,
            }
          : {
              id: request.user_id,
              email: request.request_user_email,
              name: request.request_user_full_name,
            };

      if (recipient.id && recipient.email) {
        await notifyUser({
          userId: recipient.id,
          userEmail: recipient.email,
          requestId,
          notificationType: "message_received",
          title: "You received a new CareerConnect message",
          message: `A new message was added to request ${request.request_number}.`,
          actionUrl: `/requests/${requestId}`,
          emailSubject: `New message for request ${request.request_number}`,
          emailText: `Hello ${recipient.name},

You have received a new message for request ${request.request_number}.

Log in to CareerConnect to read and reply.`,
        });
      }

      return res.status(201).json({
        success: true,
        message: "Message sent successfully.",
        requestMessage: mappedMessage,
        deliveryState,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);



async function verifyInternalNotesAccess(req, res, next) {
  const { requestId } = req.validatedParams;

  const result = await pool.query(
    `
      SELECT
        sr.id,
        sr.request_number,
        sr.assigned_counsellor_id
      FROM service_requests sr
      WHERE sr.id = $1
    `,
    [requestId],
  );

  if (!result.rowCount) {
    return res.status(404).json({
      success: false,
      message: "Request not found.",
    });
  }

  const request = result.rows[0];
  const isAdmin = req.user.role === "admin";
  const isAssignedCounsellor =
    req.user.role === "counsellor" &&
    request.assigned_counsellor_id === req.user.id;

  if (!isAdmin && !isAssignedCounsellor) {
    return res.status(403).json({
      success: false,
      message: "You do not have access to internal notes for this engagement.",
    });
  }

  req.internalNotesRequest = request;
  next();
}

router.get(
  "/:requestId/internal-notes",
  authenticateToken,
  validateParams(requestIdParamsSchema),
  verifyInternalNotesAccess,
  asyncHandler(async (req, res) => {
    const { requestId } = req.validatedParams;

    const notesResult = await pool.query(
      `
        SELECT
          rm.id,
          rm.request_id,
          rm.sender_user_id,
          rm.sender_type,
          rm.message_body,
          rm.is_internal,
          rm.read_at,
          rm.created_at,
          sender.full_name AS sender_full_name,
          sender.role AS sender_role
        FROM request_messages rm
        LEFT JOIN users sender ON sender.id = rm.sender_user_id
        WHERE rm.request_id = $1
          AND rm.is_internal = true
        ORDER BY rm.created_at ASC
      `,
      [requestId],
    );

    return res.status(200).json({
      success: true,
      count: notesResult.rowCount,
      internalNotes: notesResult.rows.map(mapMessageRecord),
    });
  }),
);

router.post(
  "/:requestId/internal-notes",
  authenticateToken,
  validateParams(requestIdParamsSchema),
  verifyInternalNotesAccess,
  validateRequest(createMessageSchema),
  asyncHandler(async (req, res) => {
    const { requestId } = req.validatedParams;
    const { messageBody } = req.validatedBody;
    const request = req.internalNotesRequest;
    const senderType = getSenderType(req.user.role);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const noteResult = await client.query(
        `
          INSERT INTO request_messages (
            request_id,
            sender_user_id,
            sender_type,
            message_body,
            is_internal
          )
          VALUES ($1, $2, $3, $4, true)
          RETURNING *
        `,
        [requestId, req.user.id, senderType, messageBody],
      );

      const createdNote = noteResult.rows[0];

      await createAuditLog({
        actorUserId: req.user.id,
        action: "INTERNAL_ENGAGEMENT_NOTE_SENT",
        entityType: "request_message",
        entityId: createdNote.id,
        requestId,
        newValues: {
          senderType,
          messageLength: messageBody.length,
          visibility: "admin_and_assigned_counsellor_only",
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        dbClient: client,
      });

      await client.query("COMMIT");

      const mappedNote = mapMessageRecord({
        ...createdNote,
        sender_full_name: req.user.full_name,
        sender_role: req.user.role,
      });

      if (request.assigned_counsellor_id) {
        emitToUser(request.assigned_counsellor_id, "internal-note:new", mappedNote);
      }
      emitToAllAdmins("internal-note:new", mappedNote);

      if (req.user.role === "counsellor") {
        try {
          await notifyActiveAdminsAboutCounsellorActivity({
            requestId,
            requestNumber: request.request_number,
            requestorName: null,
            counsellorName: req.user.full_name,
            notificationType: "counsellor_internal_note",
          });
        } catch (notificationError) {
          console.error("Unable to create counsellor internal-note alerts for admins:", {
            requestId,
            error: notificationError.message,
          });
        }
      }

      return res.status(201).json({
        success: true,
        message: "Internal note sent.",
        internalNote: mappedNote,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

module.exports = router;