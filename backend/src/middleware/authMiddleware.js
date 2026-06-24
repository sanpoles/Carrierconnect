const jwt = require("jsonwebtoken");

const env = require("../config/env");
const { pool } = require("../db/pool");

async function authenticateToken(req, res, next) {
  try {
    const authorizationHeader = req.headers.authorization;

    if (!authorizationHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required.",
      });
    }

    const token = authorizationHeader.replace("Bearer ", "").trim();

    const decodedToken = jwt.verify(token, env.jwt.secret);

    const userResult = await pool.query(
      `
        SELECT
          id,
          full_name,
          email,
          role,
          admin_scope,
          phone,
          profile_photo_url,
          is_active,
          email_verified,
          auth_version,
          created_at
        FROM users
        WHERE id = $1
      `,
      [decodedToken.userId]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({
        success: false,
        message: "User account no longer exists.",
      });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "This user account is inactive.",
      });
    }

    if (
      !decodedToken.authVersion ||
      decodedToken.authVersion !== user.auth_version
    ) {
      return res.status(401).json({
        success: false,
        message: "Your session is no longer valid. Please log in again.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please log in again.",
      });
    }

    next(error);
  }
}

function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action.",
      });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  requireRoles,
};