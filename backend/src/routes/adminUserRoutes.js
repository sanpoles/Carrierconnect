const express = require("express");
const { z } = require("zod");

const { pool } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");
const { authenticateToken, requireRoles } = require("../middleware/authMiddleware");
const { validateParams } = require("../middleware/validateParams");
const { validateQuery } = require("../middleware/validateQuery");
const { validateRequest } = require("../middleware/validateRequest");
const { createAuditLog } = require("../services/auditService");
const { notifyUser } = require("../services/notificationService");

const router = express.Router();

router.use(authenticateToken);
router.use(requireRoles("admin"));

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "User ID must be a valid UUID."
  );

const idSchema = z.object({ userId: uuid }).strict();
const reason = z
  .string()
  .trim()
  .min(5, "Reason must contain at least 5 characters.")
  .max(1000, "Reason cannot exceed 1,000 characters.");

const roleChangeSchema = z
  .object({
    role: z.enum(["user", "counsellor", "admin"]),
    adminScope: z.enum(["operational", "platform_owner"]).nullable().optional(),
    reason,
  })
  .strict()
  .superRefine((data, context) => {
    if (data.role === "admin" && !data.adminScope) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adminScope"],
        message:
          "Choose Operations Admin or Platform Owner when granting administrator access.",
      });
    }

    if (data.role !== "admin" && data.adminScope) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adminScope"],
        message: "Admin scope is only allowed for administrator accounts.",
      });
    }
  });

const stateSchema = z.object({ reason }).strict();

const querySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    role: z.enum(["user", "counsellor", "admin"]).optional(),
    active: z.enum(["true", "false"]).optional(),
    page: z.string().regex(/^\d+$/).transform(Number).optional().default(1),
    pageSize: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .refine((value) => value >= 1 && value <= 100)
      .optional()
      .default(25),
  })
  .strict();

function isPlatformOwner(user) {
  return user?.role === "admin" && user?.admin_scope === "platform_owner";
}

function requirePlatformOwner(req, res, next) {
  if (!isPlatformOwner(req.user)) {
    return res.status(403).json({
      success: false,
      message:
        "Only a Platform Owner can manage roles, administrator access, or account activation.",
    });
  }

  return next();
}

function map(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    adminScope: row.role === "admin" ? row.admin_scope || "operational" : null,
    phone: row.phone,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getActivePlatformOwnerCount(client) {
  const result = await client.query(
    `
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE role = 'admin'
        AND admin_scope = 'platform_owner'
        AND is_active = true
    `
  );

  return result.rows[0].count;
}

async function ensureCounsellorProfile(client, userId) {
  await client.query(
    `
      INSERT INTO counsellor_profiles (user_id, is_available)
      VALUES ($1, true)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId]
  );
}

router.get(
  "/users",
  requirePlatformOwner,
  validateQuery(querySchema),
  asyncHandler(async (req, res) => {
    const filters = req.validatedQuery;
    const values = [];
    const conditions = [];

    if (filters.search) {
      values.push(`%${filters.search}%`);
      conditions.push(
        `(full_name ILIKE $${values.length} OR email ILIKE $${values.length})`
      );
    }

    if (filters.role) {
      values.push(filters.role);
      conditions.push(`role = $${values.length}`);
    }

    if (filters.active) {
      values.push(filters.active === "true");
      conditions.push(`is_active = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users ${where}`,
      values
    );

    values.push(filters.pageSize, (filters.page - 1) * filters.pageSize);

    const result = await pool.query(
      `
        SELECT
          id, full_name, email, role, admin_scope, phone, is_active,
          last_login_at, created_at, updated_at
        FROM users
        ${where}
        ORDER BY
          is_active DESC,
          CASE WHEN role = 'admin' AND admin_scope = 'platform_owner' THEN 0 ELSE 1 END,
          full_name ASC
        LIMIT $${values.length - 1}
        OFFSET $${values.length}
      `,
      values
    );

    return res.status(200).json({
      success: true,
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        totalItems: countResult.rows[0].count,
        totalPages: Math.max(
          1,
          Math.ceil(countResult.rows[0].count / filters.pageSize)
        ),
      },
      users: result.rows.map(map),
    });
  })
);

router.patch(
  "/users/:userId/role",
  requirePlatformOwner,
  validateParams(idSchema),
  validateRequest(roleChangeSchema),
  asyncHandler(async (req, res) => {
    const { userId } = req.validatedParams;
    const { role, adminScope, reason: changeReason } = req.validatedBody;

    if (userId === req.user.id) {
      return res.status(409).json({
        success: false,
        message: "You cannot change your own role or Platform Owner access.",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const userResult = await client.query(
        `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );

      if (!userResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const target = userResult.rows[0];
      const currentScope =
        target.role === "admin" ? target.admin_scope || "operational" : null;
      const nextScope = role === "admin" ? adminScope : null;

      const removesPlatformOwner =
        target.role === "admin" &&
        currentScope === "platform_owner" &&
        (role !== "admin" || nextScope !== "platform_owner");

      if (
        removesPlatformOwner &&
        target.is_active &&
        (await getActivePlatformOwnerCount(client)) <= 1
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "The final active Platform Owner cannot be demoted or removed.",
        });
      }

      if (role === "counsellor") {
        await ensureCounsellorProfile(client, userId);
      }

      const updatedResult = await client.query(
        `
          UPDATE users
          SET
            role = $1,
            admin_scope = $2,
            auth_version = auth_version + 1,
            updated_at = NOW()
          WHERE id = $3
          RETURNING *
        `,
        [role, nextScope, userId]
      );

      await createAuditLog({
        actorUserId: req.user.id,
        action: "USER_ACCESS_CHANGED",
        entityType: "user",
        entityId: userId,
        oldValues: {
          role: target.role,
          adminScope: currentScope,
        },
        newValues: {
          role,
          adminScope: nextScope,
          reason: changeReason,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        dbClient: client,
      });

      await client.query("COMMIT");

      await notifyUser({
        userId,
        userEmail: target.email,
        notificationType: "general",
        title: "Your CareerConnect access was updated",
        message:
          "Your CareerConnect role or administration scope was updated. Please sign in again.",
        actionUrl: "/",
        emailSubject: "CareerConnect access updated",
        emailText: `Hello ${target.full_name},\n\nYour CareerConnect access was updated. Please sign in again to continue.`,
      });

      return res.status(200).json({
        success: true,
        message:
          "Access updated. The affected user must sign in again before the new access applies.",
        user: map(updatedResult.rows[0]),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.patch(
  "/users/:userId/deactivate",
  requirePlatformOwner,
  validateParams(idSchema),
  validateRequest(stateSchema),
  asyncHandler(async (req, res) => {
    const { userId } = req.validatedParams;
    const { reason: changeReason } = req.validatedBody;

    if (userId === req.user.id) {
      return res.status(409).json({
        success: false,
        message: "You cannot deactivate your own account.",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const userResult = await client.query(
        `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );

      if (!userResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const target = userResult.rows[0];

      if (!target.is_active) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "This account is already deactivated.",
        });
      }

      if (
        target.role === "admin" &&
        target.admin_scope === "platform_owner" &&
        (await getActivePlatformOwnerCount(client)) <= 1
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "The final active Platform Owner cannot be deactivated.",
        });
      }

      if (target.role === "counsellor") {
        const activeResult = await client.query(
          `
            SELECT COUNT(*)::int AS count
            FROM service_requests
            WHERE assigned_counsellor_id = $1
              AND status IN ('assigned', 'in_progress', 'session_scheduled')
              AND is_locked = false
          `,
          [userId]
        );

        if (activeResult.rows[0].count > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            success: false,
            message:
              "Reassign or close this counsellor's active engagements before deactivating the account.",
          });
        }
      }

      const updatedResult = await client.query(
        `
          UPDATE users
          SET
            is_active = false,
            auth_version = auth_version + 1,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [userId]
      );

      await createAuditLog({
        actorUserId: req.user.id,
        action: "USER_ACCOUNT_DEACTIVATED",
        entityType: "user",
        entityId: userId,
        oldValues: { isActive: true },
        newValues: { isActive: false, reason: changeReason },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        dbClient: client,
      });

      await client.query("COMMIT");

      return res.status(200).json({
        success: true,
        message: "Account deactivated. The user can no longer sign in.",
        user: map(updatedResult.rows[0]),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.patch(
  "/users/:userId/reactivate",
  requirePlatformOwner,
  validateParams(idSchema),
  validateRequest(stateSchema),
  asyncHandler(async (req, res) => {
    const { userId } = req.validatedParams;
    const { reason: changeReason } = req.validatedBody;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const userResult = await client.query(
        `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );

      if (!userResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const target = userResult.rows[0];

      if (target.is_active) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "This account is already active.",
        });
      }

      const updatedResult = await client.query(
        `
          UPDATE users
          SET
            is_active = true,
            auth_version = auth_version + 1,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [userId]
      );

      await createAuditLog({
        actorUserId: req.user.id,
        action: "USER_ACCOUNT_REACTIVATED",
        entityType: "user",
        entityId: userId,
        oldValues: { isActive: false },
        newValues: { isActive: true, reason: changeReason },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        dbClient: client,
      });

      await client.query("COMMIT");

      await notifyUser({
        userId,
        userEmail: target.email,
        notificationType: "general",
        title: "Your CareerConnect account was reactivated",
        message: "You can now sign in to CareerConnect again.",
        actionUrl: "/",
        emailSubject: "CareerConnect account reactivated",
        emailText: `Hello ${target.full_name},\n\nYour CareerConnect account has been reactivated. You can sign in again.`,
      });

      return res.status(200).json({
        success: true,
        message: "Account reactivated.",
        user: map(updatedResult.rows[0]),
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
