const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const env = require("./src/config/env");

const healthRoutes = require("./src/routes/healthRoutes");
const authRoutes = require("./src/routes/authRoutes");
const requestRoutes = require("./src/routes/requestRoutes");
const messageRoutes = require("./src/routes/messageRoutes");
const notificationRoutes = require("./src/routes/notificationRoutes");
const adminRoutes = require("./src/routes/adminRoutes");
const counsellorRoutes = require("./src/routes/counsellorRoutes");
const sessionRoutes = require("./src/routes/sessionRoutes");
const feedbackRoutes = require("./src/routes/feedbackRoutes");
const adminUserRoutes = require("./src/routes/adminUserRoutes");
const availabilityRoutes = require("./src/routes/availabilityRoutes");
const careerProfileRoutes = require("./src/routes/careerProfileRoutes");
const counsellorPreparationRoutes = require("./src/routes/counsellorPreparationRoutes");
const bookingRoutes = require("./src/routes/bookingRoutes");
const {
  adminToolkitRoutes,
  toolkitRoutes,
} = require("./src/routes/toolkitRoutes");

const {
  apiRateLimiter,
  authRateLimiter,
} = require("./src/middleware/rateLimiters");

const {
  initializeSocketServer,
} = require("./src/socket/socketServer");

const app = express();
const httpServer = http.createServer(app);

app.set("trust proxy", 1);
app.disable("x-powered-by");

const allowedOrigins = env.frontendUrl
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
    contentSecurityPolicy:
      env.nodeEnv === "production"
        ? undefined
        : false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error("This origin is not allowed by the API CORS policy.")
      );
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false, limit: "200kb" }));

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "CareerConnect API",
    message: "CareerConnect backend is running.",
  });
});

app.use("/api", apiRateLimiter);

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRateLimiter, authRoutes);

app.use("/api/requests", requestRoutes);
app.use("/api/requests", messageRoutes);

app.use("/api/notifications", notificationRoutes);
app.use("/api/toolkit", toolkitRoutes);

app.use("/api/admin", adminRoutes);
app.use("/api/admin", adminUserRoutes);
app.use("/api/admin", adminToolkitRoutes);
app.use("/api/counsellor/availability", availabilityRoutes);
app.use("/api/counsellor", counsellorPreparationRoutes);
app.use("/api", careerProfileRoutes);
app.use("/api", bookingRoutes);
app.use("/api/counsellor", counsellorRoutes);

app.use("/api", sessionRoutes);
app.use("/api", feedbackRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((error, req, res, next) => {
  console.error("Unhandled application error:", {
    message: error.message,
    path: req.originalUrl,
    method: req.method,
    stack: env.nodeEnv === "development" ? error.stack : undefined,
  });

  if (error.message === "This origin is not allowed by the API CORS policy.") {
    return res.status(403).json({
      success: false,
      message: "Request origin is not allowed.",
    });
  }

  return res.status(error.statusCode || 500).json({
    success: false,
    message:
      env.nodeEnv === "production"
        ? "An unexpected server error occurred."
        : error.message || "An unexpected server error occurred.",
  });
});

initializeSocketServer(httpServer);

httpServer.listen(env.port, () => {
  console.log(`CareerConnect API is running on http://localhost:${env.port}`);
  console.log(`Realtime socket server is running on port ${env.port}`);
  console.log(`Environment: ${env.nodeEnv}`);
  console.log(
    `Counsellor applications enabled: ${env.features.counsellorApplications}`
  );
});