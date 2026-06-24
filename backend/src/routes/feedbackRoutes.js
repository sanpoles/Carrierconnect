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
const { createAuditLog } = require("../services/auditService");
const { getSessionAccess } = require("../utils/sessionAccess");

const router = express.Router();

const sessionIdParamsSchema = z
  .object({
    sessionId: z.string().uuid("Session ID must be a valid UUID."),
  })
  .strict();

const feedbackSchema = z
  .object({
    rating: z
      .number()
      .int("Rating must be a whole number.")
      .min(1, "Rating must be between 1 and 5.")
      .max(5, "Rating must be between 1 and 5."),

    comments: z
      .string()
      .trim()
      .max(3000, "Comments cannot exceed 3,000 characters.")
      .optional()
      .or(z.literal("")),

    allowTestimonial: z.boolean().default(false),
  })
  .strict();

function mapFeedbackRecord(record) {
  return {
    id: record.id,
    sessionId: record.session_id,
    userId: record.user_id,
    counsellorId: record.counsellor_id,
    rating: record.rating,
    comments: record.comments,
    allowTestimonial: record.allow_testimonial,
    testimonialApproved: record.testimonial_approved,
    testimonialApprovedAt: record.testimonial_approved_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

router.get(
  "/sessions/:sessionId/feedback",
  authenticateToken,
  validateParams(sessionIdParamsSchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.validatedParams;

    const access = await getSessionAccess(sessionId, req.user);

    if (!access.exists) {
      return res.status(404).json({
        success: false,
        message: "Session not found.",
      });
    }

    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this session feedback.",
      });
    }

    const result = await pool.query(
      `
        SELECT
          id,
          session_id,
          user_id,
          counsellor_id,
          rating,
          comments,
          allow_testimonial,
          testimonial_approved,
          testimonial_approved_at,
          created_at,
          updated_at
        FROM session_feedback
        WHERE session_id = $1
      `,
      [sessionId]
    );

    return res.status(200).json({
      success: true,
      feedback:
        result.rowCount > 0
          ? mapFeedbackRecord(result.rows[0])
          : null,
    });
  })
);

router.post(
  "/sessions/:sessionId/feedback",
  authenticateToken,
  requireRoles("user"),
  validateParams(sessionIdParamsSchema),
  validateRequest(feedbackSchema),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.validatedParams;
    const { rating, comments, allowTestimonial } = req.validatedBody;

    const access = await getSessionAccess(sessionId, req.user);

    if (!access.exists) {
      return res.status(404).json({
        success: false,
        message: "Session not found.",
      });
    }

    const session = access.session;

    if (session.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message:
          "Only the user who attended this session can submit feedback.",
      });
    }

    if (session.status !== "completed") {
      return res.status(409).json({
        success: false,
        message:
          "Feedback can only be submitted after a session is completed.",
      });
    }

    const existingFeedback = await pool.query(
      `
        SELECT id
        FROM session_feedback
        WHERE session_id = $1
      `,
      [sessionId]
    );

    if (existingFeedback.rowCount > 0) {
      return res.status(409).json({
        success: false,
        message:
          "Feedback has already been submitted for this session.",
      });
    }

    const result = await pool.query(
      `
        INSERT INTO session_feedback (
          session_id,
          user_id,
          counsellor_id,
          rating,
          comments,
          allow_testimonial
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [
        sessionId,
        req.user.id,
        session.counsellor_id,
        rating,
        comments || null,
        allowTestimonial,
      ]
    );

    const feedback = result.rows[0];

    await createAuditLog({
      actorUserId: req.user.id,
      action: "SESSION_FEEDBACK_SUBMITTED",
      entityType: "session_feedback",
      entityId: feedback.id,
      requestId: session.request_id,
      newValues: {
        rating,
        allowTestimonial,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    return res.status(201).json({
      success: true,
      message: "Thank you. Your feedback has been submitted.",
      feedback: mapFeedbackRecord(feedback),
    });
  })
);

module.exports = router;