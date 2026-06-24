const express = require("express");
const { checkDatabaseConnection } = require("../db/pool");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const database = await checkDatabaseConnection();

    res.status(200).json({
      success: true,
      service: "careerconnect-api",
      version: "1.0.0",
      status: "healthy",
      database,
      timestamp: new Date().toISOString(),
    });
  })
);

module.exports = router;