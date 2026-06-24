const dotenv = require("dotenv");

dotenv.config();

const requiredEnvironmentVariables = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "JWT_SECRET",
];

for (const variableName of requiredEnvironmentVariables) {
  if (!process.env[variableName]) {
    throw new Error(
      `Missing required environment variable: ${variableName}`
    );
  }
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),

  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",

  database: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DATABASE_SSL === "true",
    sslRejectUnauthorized:
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true",
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },

  passwordReset: {
    ttlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30),
    maxRequestsPerEmailWindow: Number(
      process.env.PASSWORD_RESET_MAX_PER_EMAIL_WINDOW || 3
    ),
    maxRequestsPerIpWindow: Number(
      process.env.PASSWORD_RESET_MAX_PER_IP_WINDOW || 10
    ),
    rateLimitWindowMinutes: Number(
      process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MINUTES || 30
    ),
  },

  features: {
    counsellorApplications:
      process.env.ENABLE_COUNSELLOR_APPLICATIONS === "true",
  },

  email: {
    provider: process.env.EMAIL_PROVIDER || "console",
    from: process.env.EMAIL_FROM || "CareerConnect <no-reply@localhost>",
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpSecure: process.env.SMTP_SECURE === "true",
    smtpUser: process.env.SMTP_USER,
    smtpPassword: process.env.SMTP_PASSWORD,
  },

  uploads: {
    directory: process.env.UPLOADS_DIRECTORY || "./storage/private",
    maxResumeBytes: Number(process.env.MAX_RESUME_BYTES || 5 * 1024 * 1024),
    allowedResumeMimeTypes: (process.env.ALLOWED_RESUME_MIME_TYPES || "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  },

  admin: {
    fullName: process.env.ADMIN_FULL_NAME,
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },
};

module.exports = env;