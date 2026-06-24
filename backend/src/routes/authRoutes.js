const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");

const { pool } = require("../db/pool");
const env = require("../config/env");
const asyncHandler = require("../utils/asyncHandler");
const { authenticateToken } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const { createAuditLog } = require("../services/auditService");
const { sendPasswordResetEmail } = require("../services/emailService");

const router = express.Router();

const genericInvalidLoginMessage =
  "The email address or password is incorrect. Please try again.";

const forgotPasswordConfirmationMessage =
  "If an account exists for this email address, password reset instructions have been sent.";

const registerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Full name must contain at least 2 characters.")
      .max(150, "Full name cannot exceed 150 characters."),

    email: z
      .string()
      .trim()
      .email("Please provide a valid email address.")
      .max(255, "Email cannot exceed 255 characters."),

    password: z
      .string()
      .min(12, "Password must contain at least 12 characters.")
      .max(128, "Password cannot exceed 128 characters.")
      .regex(/[a-z]/, "Password must include at least one lowercase letter.")
      .regex(/[A-Z]/, "Password must include at least one uppercase letter.")
      .regex(/[0-9]/, "Password must include at least one number."),

    phone: z
      .string()
      .trim()
      .max(30, "Phone number cannot exceed 30 characters.")
      .regex(
        /^[0-9+\-()\s]*$/,
        "Phone number contains unsupported characters."
      )
      .optional()
      .or(z.literal("")),
  })
  .strict();

const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email("Please provide a valid email address.")
      .max(255, "Email cannot exceed 255 characters."),

    password: z
      .string()
      .min(1, "Password is required.")
      .max(128, "Password cannot exceed 128 characters."),
  })
  .strict();

const forgotPasswordSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email("Please provide a valid email address.")
      .max(255, "Email cannot exceed 255 characters."),
  })
  .strict();

const resetPasswordSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(40, "Password reset link is invalid or expired.")
      .max(256, "Password reset link is invalid or expired."),

    password: z
      .string()
      .min(12, "Password must contain at least 12 characters.")
      .max(128, "Password cannot exceed 128 characters.")
      .regex(/[a-z]/, "Password must include at least one lowercase letter.")
      .regex(/[A-Z]/, "Password must include at least one uppercase letter.")
      .regex(/[0-9]/, "Password must include at least one number."),

    confirmPassword: z
      .string()
      .min(1, "Please confirm your new password.")
      .max(128, "Password confirmation cannot exceed 128 characters."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Password and confirmation do not match.",
    path: ["confirmPassword"],
  })
  .strict();

const updateProfileSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Full name must contain at least 2 characters.")
      .max(150, "Full name cannot exceed 150 characters."),

    phone: z
      .string()
      .trim()
      .max(30, "Phone number cannot exceed 30 characters.")
      .regex(
        /^[0-9+\-()\s]*$/,
        "Phone number contains unsupported characters."
      )
      .optional()
      .or(z.literal("")),

    profilePhotoUrl: z
      .string()
      .trim()
      .url("Profile photo URL must be valid.")
      .max(2000, "Profile photo URL is too long.")
      .optional()
      .or(z.literal("")),
  })
  .strict();

function createJwtToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      adminScope: user.role === "admin" ? user.admin_scope || "operational" : null,
      authVersion: user.auth_version,
    },
    env.jwt.secret,
    {
      expiresIn: env.jwt.expiresIn,
    }
  );
}

function buildSafeUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    adminScope: user.role === "admin" ? user.admin_scope || "operational" : null,
    phone: user.phone,
    profilePhotoUrl: user.profile_photo_url,
    emailVerified: user.email_verified,
    createdAt: user.created_at,
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getPrimaryFrontendUrl() {
  return env.frontendUrl
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)[0];
}

function getClientIpAddress(req) {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim().slice(0, 100);
  }

  return String(req.ip || "").slice(0, 100) || null;
}

async function clearExpiredPasswordResetData() {
  await Promise.all([
    pool.query(
      `
        DELETE FROM password_reset_tokens
        WHERE expires_at < NOW() - INTERVAL '1 day'
      `
    ),
    pool.query(
      `
        DELETE FROM password_reset_requests
        WHERE requested_at < NOW() - INTERVAL '2 days'
      `
    ),
  ]);
}

async function isPasswordResetRequestAllowed({ emailHash, ipAddress }) {
  const rateWindowMinutes = env.passwordReset.rateLimitWindowMinutes;

  const [emailResult, ipResult] = await Promise.all([
    pool.query(
      `
        SELECT COUNT(*)::int AS request_count
        FROM password_reset_requests
        WHERE email_hash = $1
          AND requested_at >= NOW() - ($2::int * INTERVAL '1 minute')
      `,
      [emailHash, rateWindowMinutes]
    ),
    pool.query(
      `
        SELECT COUNT(*)::int AS request_count
        FROM password_reset_requests
        WHERE ip_address = $1
          AND requested_at >= NOW() - ($2::int * INTERVAL '1 minute')
      `,
      [ipAddress, rateWindowMinutes]
    ),
  ]);

  const emailCount = emailResult.rows[0].request_count;
  const ipCount = ipResult.rows[0].request_count;

  return (
    emailCount < env.passwordReset.maxRequestsPerEmailWindow &&
    ipCount < env.passwordReset.maxRequestsPerIpWindow
  );
}

async function recordPasswordResetRequest({ emailHash, ipAddress }) {
  await pool.query(
    `
      INSERT INTO password_reset_requests (
        email_hash,
        ip_address
      )
      VALUES ($1, $2)
    `,
    [emailHash, ipAddress]
  );
}

router.post(
  "/register",
  validateRequest(registerSchema),
  asyncHandler(async (req, res) => {
    const { fullName, email, password, phone } = req.validatedBody;

    const normalizedEmail = email.toLowerCase();

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existingUser.rowCount > 0) {
      return res.status(409).json({
        success: false,
        message: "An account already exists with this email address.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const userResult = await pool.query(
      `
        INSERT INTO users (
          full_name,
          email,
          password_hash,
          phone,
          role
        )
        VALUES ($1, $2, $3, $4, 'user')
        RETURNING
          id,
          full_name,
          email,
          role,
          admin_scope,
          phone,
          profile_photo_url,
          email_verified,
          auth_version,
          created_at
      `,
      [fullName, normalizedEmail, passwordHash, phone || null]
    );

    const user = userResult.rows[0];

    await createAuditLog({
      actorUserId: user.id,
      action: "USER_REGISTERED",
      entityType: "user",
      entityId: user.id,
      newValues: {
        email: user.email,
        role: user.role,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    const token = createJwtToken(user);

    res.status(201).json({
      success: true,
      message: "Registration completed successfully.",
      token,
      user: buildSafeUser(user),
    });
  })
);

router.post(
  "/login",
  validateRequest(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.validatedBody;

    const normalizedEmail = email.toLowerCase();

    const userResult = await pool.query(
      `
        SELECT
          id,
          full_name,
          email,
          password_hash,
          role,
          admin_scope,
          phone,
          profile_photo_url,
          is_active,
          email_verified,
          auth_version,
          created_at
        FROM users
        WHERE email = $1
      `,
      [normalizedEmail]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({
        success: false,
        message: genericInvalidLoginMessage,
      });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "This account is inactive. Please contact support.",
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: genericInvalidLoginMessage,
      });
    }

    await pool.query(
      `
        UPDATE users
        SET last_login_at = NOW()
        WHERE id = $1
      `,
      [user.id]
    );

    await createAuditLog({
      actorUserId: user.id,
      action: "USER_LOGGED_IN",
      entityType: "user",
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    const token = createJwtToken(user);

    res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      user: buildSafeUser(user),
    });
  })
);

router.post(
  "/forgot-password",
  validateRequest(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const normalizedEmail = req.validatedBody.email.toLowerCase();
    const emailHash = sha256(normalizedEmail);
    const ipAddress = getClientIpAddress(req);

    await clearExpiredPasswordResetData();

    const allowed = await isPasswordResetRequestAllowed({
      emailHash,
      ipAddress,
    });

    if (!allowed) {
      return res.status(200).json({
        success: true,
        message: forgotPasswordConfirmationMessage,
      });
    }

    await recordPasswordResetRequest({
      emailHash,
      ipAddress,
    });

    const userResult = await pool.query(
      `
        SELECT
          id,
          full_name,
          email,
          is_active
        FROM users
        WHERE email = $1
      `,
      [normalizedEmail]
    );

    if (userResult.rowCount === 0 || !userResult.rows[0].is_active) {
      return res.status(200).json({
        success: true,
        message: forgotPasswordConfirmationMessage,
      });
    }

    const user = userResult.rows[0];
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(
      Date.now() + env.passwordReset.ttlMinutes * 60 * 1000
    );

    await pool.query(
      `
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE user_id = $1
          AND used_at IS NULL
      `,
      [user.id]
    );

    await pool.query(
      `
        INSERT INTO password_reset_tokens (
          user_id,
          token_hash,
          expires_at,
          requested_ip
        )
        VALUES ($1, $2, $3, $4)
      `,
      [user.id, tokenHash, expiresAt, ipAddress]
    );

    await createAuditLog({
      actorUserId: user.id,
      action: "PASSWORD_RESET_REQUESTED",
      entityType: "user",
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    const resetUrl = `${getPrimaryFrontendUrl()}/reset-password?token=${encodeURIComponent(
      rawToken
    )}`;

    try {
      await sendPasswordResetEmail({
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
        resetUrl,
      });
    } catch (error) {
      console.error("Unable to send password reset email:", {
        userId: user.id,
        message: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: forgotPasswordConfirmationMessage,
    });
  })
);

router.post(
  "/reset-password",
  validateRequest(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.validatedBody;
    const tokenHash = sha256(token);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const tokenResult = await client.query(
        `
          SELECT
            prt.id AS reset_token_id,
            prt.user_id,
            u.email,
            u.full_name,
            u.role,
            u.admin_scope,
            u.phone,
            u.profile_photo_url,
            u.email_verified,
            u.created_at
          FROM password_reset_tokens prt
          INNER JOIN users u
            ON u.id = prt.user_id
          WHERE prt.token_hash = $1
            AND prt.used_at IS NULL
            AND prt.expires_at > NOW()
            AND u.is_active = true
          FOR UPDATE
        `,
        [tokenHash]
      );

      if (tokenResult.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          success: false,
          message:
            "This password reset link is invalid or has expired. Please request a new one.",
        });
      }

      const resetRecord = tokenResult.rows[0];
      const passwordHash = await bcrypt.hash(password, 12);

      const updatedUserResult = await client.query(
        `
          UPDATE users
          SET
            password_hash = $1,
            auth_version = auth_version + 1,
            updated_at = NOW()
          WHERE id = $2
          RETURNING
            id,
            full_name,
            email,
            role,
          admin_scope,
            phone,
            profile_photo_url,
            email_verified,
            auth_version,
            created_at
        `,
        [passwordHash, resetRecord.user_id]
      );

      await client.query(
        `
          UPDATE password_reset_tokens
          SET used_at = NOW()
          WHERE user_id = $1
            AND used_at IS NULL
        `,
        [resetRecord.user_id]
      );

      await createAuditLog({
        actorUserId: resetRecord.user_id,
        action: "PASSWORD_RESET_COMPLETED",
        entityType: "user",
        entityId: resetRecord.user_id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        dbClient: client,
      });

      await client.query("COMMIT");

      return res.status(200).json({
        success: true,
        message:
          "Your password has been reset successfully. Please log in with your new password.",
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/me",
  authenticateToken,
  asyncHandler(async (req, res) => {
    res.status(200).json({
      success: true,
      user: buildSafeUser(req.user),
    });
  })
);

router.put(
  "/me",
  authenticateToken,
  validateRequest(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const { fullName, phone, profilePhotoUrl } = req.validatedBody;

    const userResult = await pool.query(
      `
        UPDATE users
        SET
          full_name = $1,
          phone = $2,
          profile_photo_url = $3
        WHERE id = $4
        RETURNING
          id,
          full_name,
          email,
          role,
          admin_scope,
          phone,
          profile_photo_url,
          email_verified,
          auth_version,
          created_at
      `,
      [fullName, phone || null, profilePhotoUrl || null, req.user.id]
    );

    const user = userResult.rows[0];

    await createAuditLog({
      actorUserId: user.id,
      action: "USER_PROFILE_UPDATED",
      entityType: "user",
      entityId: user.id,
      newValues: {
        fullName: user.full_name,
        phone: user.phone,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: buildSafeUser(user),
    });
  })
);

module.exports = router;