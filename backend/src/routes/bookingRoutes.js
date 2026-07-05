const express = require("express");
const { z } = require("zod");

const env = require("../config/env");
const { pool } = require("../db/pool");
const { authenticateToken, requireRoles } = require("../middleware/authMiddleware");
const { validateParams } = require("../middleware/validateParams");
const { validateQuery } = require("../middleware/validateQuery");
const { validateRequest } = require("../middleware/validateRequest");
const { assertCounsellorAvailable, listAvailableSlots } = require("../services/availabilityService");
const { createAuditLog } = require("../services/auditService");
const { getDeliveryState, canScheduleForEngagement } = require("../services/entitlementService");
const { notifyUser } = require("../services/notificationService");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

const requestIdParamsSchema = z
  .object({
    requestId: z
      .string()
      .regex(/^[0-9a-f-]{36}$/i, "Request ID must be a valid UUID."),
  })
  .strict();

const slotQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()
  .refine((value) => value.from <= value.to, {
    message: "from must be before to",
  });

const bookingBodySchema = z
  .object({
    scheduledStartAt: z.string().datetime(),
    scheduledEndAt: z.string().datetime(),
  })
  .strict();

function hasServiceContact(record) {
  return Boolean(
    record.service_phone_e164 ||
      (record.phone_e164 && record.service_contact_consent_at)
  );
}

router.get(
  "/requests/:requestId/available-slots",
  authenticateToken,
  requireRoles("user"),
  validateParams(requestIdParamsSchema),
  validateQuery(slotQuerySchema),
  asyncHandler(async (req, res) => {
    const requestResult = await pool.query(
      "SELECT assigned_counsellor_id FROM service_requests WHERE id=$1 AND user_id=$2",
      [req.validatedParams.requestId, req.user.id]
    );

    if (!requestResult.rowCount) {
      return res.status(404).json({ success: false, message: "Request not found." });
    }

    if (!requestResult.rows[0].assigned_counsellor_id) {
      return res.status(409).json({
        success: false,
        message: "A counsellor must be assigned before slots can be shown.",
      });
    }

    const deliveryState = await getDeliveryState(req.validatedParams.requestId);
    const permission = canScheduleForEngagement(deliveryState);

    if (!permission.allowed) {
      return res.status(409).json({ success: false, message: permission.reason });
    }

    const slots = await listAvailableSlots({
      counsellorId: requestResult.rows[0].assigned_counsellor_id,
      fromDate: req.validatedQuery.from,
      toDate: req.validatedQuery.to,
    });

    res.json({ success: true, ...slots });
  })
);

router.post(
  "/requests/:requestId/book-session",
  authenticateToken,
  requireRoles("user"),
  validateParams(requestIdParamsSchema),
  validateRequest(bookingBodySchema),
  asyncHandler(async (req, res) => {
    const { requestId } = req.validatedParams;
    const body = req.validatedBody;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const requestResult = await client.query(
        `SELECT
          sr.*,
          u.full_name AS user_full_name,
          u.email AS user_email,
          u.phone_e164,
          u.service_contact_consent_at,
          c.full_name AS counsellor_full_name,
          c.email AS counsellor_email
         FROM service_requests sr
         INNER JOIN users u ON u.id=sr.user_id
         LEFT JOIN users c ON c.id=sr.assigned_counsellor_id
         WHERE sr.id=$1 AND sr.user_id=$2
         FOR UPDATE`,
        [requestId, req.user.id]
      );

      if (!requestResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Request not found." });
      }

      const request = requestResult.rows[0];

      if (env.features.requireRequestPhone && !hasServiceContact(request)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message:
            "Add a service contact phone number before booking a session.",
          missingServiceContact: true,
        });
      }

      if (!request.assigned_counsellor_id) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ success: false, message: "A counsellor must be assigned before booking." });
      }

      const deliveryState = await getDeliveryState(requestId, {
        dbClient: client,
        forUpdate: true,
      });
      const permission = canScheduleForEngagement(deliveryState);

      if (!permission.allowed) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: permission.reason });
      }

      const startsAt = new Date(body.scheduledStartAt);
      const endsAt = new Date(body.scheduledEndAt);
      const availability = await assertCounsellorAvailable({
        counsellorId: request.assigned_counsellor_id,
        startAt: startsAt,
        endAt: endsAt,
        dbClient: client,
      });

      if (!availability.allowed) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: availability.reason });
      }

      const conflictResult = await client.query(
        `SELECT id
         FROM sessions
         WHERE counsellor_id=$1
           AND status='scheduled'
           AND scheduled_start_at<$3
           AND scheduled_end_at>$2
         FOR UPDATE`,
        [request.assigned_counsellor_id, startsAt.toISOString(), endsAt.toISOString()]
      );

      if (conflictResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "That slot was just booked. Choose another available time.",
        });
      }

      const sessionResult = await client.query(
        `INSERT INTO sessions(
          request_id,
          user_id,
          counsellor_id,
          title,
          scheduled_start_at,
          scheduled_end_at,
          timezone,
          meeting_provider,
          status
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,'To be confirmed','scheduled')
        RETURNING *`,
        [
          requestId,
          req.user.id,
          request.assigned_counsellor_id,
          `${request.request_number} - Session`,
          startsAt.toISOString(),
          endsAt.toISOString(),
          availability.timezone,
        ]
      );

      await client.query("UPDATE service_requests SET status='session_scheduled' WHERE id=$1", [
        requestId,
      ]);

      await createAuditLog({
        actorUserId: req.user.id,
        action: "SESSION_BOOKED_BY_USER",
        entityType: "session",
        entityId: sessionResult.rows[0].id,
        requestId,
        newValues: {
          scheduledStartAt: startsAt.toISOString(),
          scheduledEndAt: endsAt.toISOString(),
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        dbClient: client,
      });

      await client.query("COMMIT");

      await notifyUser({
        userId: request.assigned_counsellor_id,
        userEmail: request.counsellor_email,
        requestId,
        sessionId: sessionResult.rows[0].id,
        notificationType: "session_scheduled",
        title: "A user booked an available session slot",
        message: `${request.user_full_name} booked a session for ${request.request_number}.`,
        actionUrl: "/counsellor/dashboard",
        emailSubject: `Session booked: ${request.request_number}`,
        emailText: `Hello ${request.counsellor_full_name},\n\n${request.user_full_name} booked an available slot. Log in to add the meeting link.`,
      });

      res.status(201).json({
        success: true,
        message: "Your session is booked. Your counsellor will add the meeting link.",
        session: sessionResult.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
