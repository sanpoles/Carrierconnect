const express = require("express");
const { z } = require("zod");

const { pool } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");
const { validateRequest } = require("../middleware/validateRequest");
const { notifyUser } = require("../services/notificationService");
const { emitToAllAdmins } = require("../socket/socketServer");

const router = express.Router();

const createInquirySchema = z.object({
  organizationName: z.string().trim().min(2, "Organization name must contain at least 2 characters.").max(200),
  contactName: z.string().trim().min(2, "Your name must contain at least 2 characters.").max(150),
  workEmail: z.string().trim().email("Enter a valid work email address.").max(320),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  countryOrRegion: z.string().trim().max(120).optional().or(z.literal("")),
  organizationSize: z.string().trim().max(80).optional().or(z.literal("")),
  supportArea: z.enum([
    "hiring_talent_support",
    "leadership_development",
    "career_internal_mobility",
    "custom_workforce_program",
    "not_sure_yet",
  ]),
  targetAudience: z.string().trim().max(160).optional().or(z.literal("")),
  expectedScope: z.string().trim().max(160).optional().or(z.literal("")),
  desiredTimeline: z.string().trim().max(160).optional().or(z.literal("")),
  currentChallenge: z.string().trim().min(20, "Please share at least a short description of the challenge.").max(5000),
  successOutcome: z.string().trim().max(3000).optional().or(z.literal("")),
  preferredDiscussionTime: z.string().trim().max(160).optional().or(z.literal("")),
  contactPreference: z.enum(["email", "phone", "either"]).default("email"),
}).strict();

function mapInquiry(record) {
  return {
    id: record.id,
    organizationName: record.organization_name,
    contactName: record.contact_name,
    workEmail: record.work_email,
    phone: record.phone,
    countryOrRegion: record.country_or_region,
    organizationSize: record.organization_size,
    supportArea: record.support_area,
    targetAudience: record.target_audience,
    expectedScope: record.expected_scope,
    desiredTimeline: record.desired_timeline,
    currentChallenge: record.current_challenge,
    successOutcome: record.success_outcome,
    preferredDiscussionTime: record.preferred_discussion_time,
    contactPreference: record.contact_preference,
    status: record.status,
    createdAt: record.created_at,
  };
}

router.post(
  "/",
  validateRequest(createInquirySchema),
  asyncHandler(async (req, res) => {
    const payload = req.validatedBody;

    const result = await pool.query(
      `
        INSERT INTO organization_inquiries (
          organization_name, contact_name, work_email, phone,
          country_or_region, organization_size, support_area,
          target_audience, expected_scope, desired_timeline,
          current_challenge, success_outcome, preferred_discussion_time,
          contact_preference, status
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'new'
        )
        RETURNING *
      `,
      [
        payload.organizationName,
        payload.contactName,
        payload.workEmail.toLowerCase(),
        payload.phone || null,
        payload.countryOrRegion || null,
        payload.organizationSize || null,
        payload.supportArea,
        payload.targetAudience || null,
        payload.expectedScope || null,
        payload.desiredTimeline || null,
        payload.currentChallenge,
        payload.successOutcome || null,
        payload.preferredDiscussionTime || null,
        payload.contactPreference,
      ]
    );

    const inquiry = mapInquiry(result.rows[0]);

    const adminResult = await pool.query(
      `SELECT id, full_name, email FROM users WHERE role = 'admin' AND is_active = true`
    );

    await Promise.allSettled(
      adminResult.rows
        .filter((admin) => admin.email)
        .map((admin) =>
          notifyUser({
            userId: admin.id,
            userEmail: admin.email,
            notificationType: "general",
            title: "New organization enquiry",
            message: `${inquiry.organizationName} requested a discussion about ${inquiry.supportArea.replaceAll("_", " ")}.`,
            actionUrl: "/admin/overview",
            emailSubject: `New organization enquiry: ${inquiry.organizationName}`,
            emailText: `Hello ${admin.full_name},\n\nA new organization enquiry was submitted.\n\nOrganization: ${inquiry.organizationName}\nContact: ${inquiry.contactName}\nEmail: ${inquiry.workEmail}\nSupport area: ${inquiry.supportArea.replaceAll("_", " ")}\n\nLog in to CareerConnect to review operational notifications.`,
          })
        )
    );

    emitToAllAdmins("organization-inquiry:new", inquiry);

    return res.status(201).json({
      success: true,
      message: "Thank you. A CareerConnect team member will contact you shortly.",
      inquiry: {
        id: inquiry.id,
        status: inquiry.status,
        createdAt: inquiry.createdAt,
      },
    });
  })
);

module.exports = router;
