const { rateLimit } = require("express-rate-limit");

const isProduction = process.env.NODE_ENV === "production";

function nonProductionNumber(name, fallback) {
  if (isProduction) {
    return fallback;
  }

  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: nonProductionNumber("API_RATE_LIMIT_MAX", 300),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: nonProductionNumber("AUTH_RATE_LIMIT_MAX", 20),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Too many authentication attempts. Please wait 15 minutes and try again.",
  },
});

module.exports = {
  apiRateLimiter,
  authRateLimiter,
};
