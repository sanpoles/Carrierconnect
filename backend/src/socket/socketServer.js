const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const env = require("../config/env");
const { pool } = require("../db/pool");

let io = null;

function getAllowedOrigins() {
  return env.frontendUrl
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function initializeSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication token is required."));
      }

      const decodedToken = jwt.verify(token, env.jwt.secret);

      const userResult = await pool.query(
        `
          SELECT
            id,
            full_name,
            email,
            role,
            is_active
          FROM users
          WHERE id = $1
        `,
        [decodedToken.userId]
      );

      if (userResult.rowCount === 0) {
        return next(new Error("User account no longer exists."));
      }

      const user = userResult.rows[0];

      if (!user.is_active) {
        return next(new Error("User account is inactive."));
      }

      socket.user = {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
      };

      return next();
    } catch (error) {
      return next(new Error("Socket authentication failed."));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.user.id}`);
    socket.join(`role:${socket.user.role}`);

    console.log(
      `Realtime connected: ${socket.user.email} (${socket.user.role})`
    );

    socket.on("disconnect", () => {
      console.log(`Realtime disconnected: ${socket.user.email}`);
    });
  });

  return io;
}

function emitToUser(userId, eventName, payload) {
  if (!io || !userId) {
    return;
  }

  io.to(`user:${userId}`).emit(eventName, payload);
}

function emitToRole(role, eventName, payload) {
  if (!io || !role) {
    return;
  }

  io.to(`role:${role}`).emit(eventName, payload);
}

function emitToAllAdmins(eventName, payload) {
  emitToRole("admin", eventName, payload);
}

module.exports = {
  initializeSocketServer,
  emitToUser,
  emitToRole,
  emitToAllAdmins,
};