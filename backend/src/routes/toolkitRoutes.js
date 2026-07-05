const express = require("express");
const { z } = require("zod");

const env = require("../config/env");
const { pool } = require("../db/pool");
const { authenticateToken, requireRoles } = require("../middleware/authMiddleware");
const { validateParams } = require("../middleware/validateParams");
const { validateQuery } = require("../middleware/validateQuery");
const { validateRequest } = require("../middleware/validateRequest");
const { createAuditLog } = require("../services/auditService");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
const adminRouter = express.Router();

const slugSchema = z
  .object({
    slug: z.string().trim().min(2).max(150).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

const idSchema = z.object({ resourceId: z.string().uuid() }).strict();

const resourceQuerySchema = z
  .object({
    category: z.string().trim().max(100).optional(),
    type: z
      .enum(["guide", "framework", "checklist", "worksheet", "template", "answer_library"])
      .optional(),
    search: z.string().trim().max(150).optional(),
  })
  .strict();

const resourceBodySchema = z
  .object({
    categoryId: z.string().uuid(),
    slug: z.string().trim().min(2).max(150).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(5).max(220),
    description: z.string().trim().min(10).max(2000),
    resourceType: z.enum([
      "guide",
      "framework",
      "checklist",
      "worksheet",
      "template",
      "answer_library",
    ]),
    readingTimeMinutes: z.number().int().min(1).max(120),
    previewBody: z.string().trim().min(20).max(3000),
    whatYouWillLearn: z.array(z.string().trim().min(3).max(180)).max(12).default([]),
    contentBlocks: z
      .array(
        z.object({
          type: z.enum(["heading", "paragraph", "list", "callout"]),
          heading: z.string().trim().max(220).optional(),
          body: z.string().trim().max(5000).optional(),
          items: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
        })
      )
      .max(60)
      .default([]),
    status: z.enum(["draft", "published", "archived"]).default("draft"),
  })
  .strict();

const statusBodySchema = z.object({
  status: z.enum(["draft", "published", "archived"]),
}).strict();

function requireToolkitEnabled(req, res, next) {
  if (!env.features.careerToolkit) {
    return res.status(404).json({ success: false, message: "Career Toolkit is unavailable." });
  }

  return next();
}

function isPlatformOwner(user) {
  return user?.role === "admin" && user?.admin_scope === "platform_owner";
}

function requirePlatformOwner(req, res, next) {
  if (!isPlatformOwner(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Platform owner access is required for Toolkit publishing.",
    });
  }

  return next();
}

function mapCategory(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    displayOrder: row.display_order,
    isActive: row.is_active,
  };
}

function mapResource(row, { includeContent = false } = {}) {
  return {
    id: row.id,
    category: {
      id: row.category_id,
      slug: row.category_slug,
      name: row.category_name,
    },
    slug: row.slug,
    title: row.title,
    description: row.description,
    resourceType: row.resource_type,
    readingTimeMinutes: row.reading_time_minutes,
    previewBody: row.preview_body,
    whatYouWillLearn: row.what_you_will_learn || [],
    status: row.status,
    publishedAt: row.published_at,
    saved: row.saved === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(includeContent ? { contentBlocks: row.content_blocks || [] } : {}),
  };
}

const resourceSelect = `
  SELECT
    tr.*,
    tc.slug AS category_slug,
    tc.name AS category_name
  FROM toolkit_resources tr
  INNER JOIN toolkit_categories tc ON tc.id = tr.category_id
`;

router.use(requireToolkitEnabled);

router.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT *
       FROM toolkit_categories
       WHERE is_active=true
       ORDER BY display_order ASC, name ASC`
    );

    res.json({
      success: true,
      categories: result.rows.map(mapCategory),
    });
  })
);

router.get(
  "/resources",
  validateQuery(resourceQuerySchema),
  asyncHandler(async (req, res) => {
    const conditions = ["tr.status='published'", "tc.is_active=true"];
    const values = [];

    if (req.validatedQuery.category) {
      values.push(req.validatedQuery.category);
      conditions.push(`tc.slug=$${values.length}`);
    }

    if (req.validatedQuery.type) {
      values.push(req.validatedQuery.type);
      conditions.push(`tr.resource_type=$${values.length}`);
    }

    if (req.validatedQuery.search) {
      values.push(`%${req.validatedQuery.search}%`);
      conditions.push(
        `(tr.title ILIKE $${values.length} OR tr.description ILIKE $${values.length})`
      );
    }

    const result = await pool.query(
      `${resourceSelect}
       WHERE ${conditions.join(" AND ")}
       ORDER BY tc.display_order ASC, tr.published_at DESC, tr.title ASC`,
      values
    );

    res.json({
      success: true,
      resources: result.rows.map((row) => mapResource(row)),
    });
  })
);

router.get(
  "/resources/:slug",
  validateParams(slugSchema),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `${resourceSelect}
       WHERE tr.slug=$1 AND tr.status='published' AND tc.is_active=true`,
      [req.validatedParams.slug]
    );

    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: "Toolkit resource not found." });
    }

    res.json({
      success: true,
      resource: mapResource(result.rows[0]),
      access: {
        fullContentRequiresLogin: true,
      },
    });
  })
);

router.get(
  "/resources/:slug/full",
  authenticateToken,
  requireRoles("user", "counsellor", "admin"),
  validateParams(slugSchema),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT
        tr.*,
        tc.slug AS category_slug,
        tc.name AS category_name,
        (trs.user_id IS NOT NULL) AS saved
       FROM toolkit_resources tr
       INNER JOIN toolkit_categories tc ON tc.id = tr.category_id
       LEFT JOIN toolkit_resource_saves trs
         ON trs.resource_id=tr.id AND trs.user_id=$2
       WHERE tr.slug=$1 AND tr.status='published' AND tc.is_active=true`,
      [req.validatedParams.slug, req.user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: "Toolkit resource not found." });
    }

    res.json({
      success: true,
      resource: mapResource(result.rows[0], { includeContent: true }),
    });
  })
);

router.get(
  "/my/saves",
  authenticateToken,
  requireRoles("user"),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `${resourceSelect}
       INNER JOIN toolkit_resource_saves trs ON trs.resource_id=tr.id
       WHERE trs.user_id=$1 AND tr.status='published' AND tc.is_active=true
       ORDER BY trs.saved_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      resources: result.rows.map((row) => mapResource({ ...row, saved: true })),
    });
  })
);

router.post(
  "/resources/:resourceId/save",
  authenticateToken,
  requireRoles("user"),
  validateParams(idSchema),
  asyncHandler(async (req, res) => {
    const resourceResult = await pool.query(
      "SELECT id FROM toolkit_resources WHERE id=$1 AND status='published'",
      [req.validatedParams.resourceId]
    );

    if (!resourceResult.rowCount) {
      return res.status(404).json({ success: false, message: "Toolkit resource not found." });
    }

    await pool.query(
      `INSERT INTO toolkit_resource_saves(user_id, resource_id)
       VALUES($1, $2)
       ON CONFLICT(user_id, resource_id) DO NOTHING`,
      [req.user.id, req.validatedParams.resourceId]
    );

    res.json({ success: true, message: "Resource saved." });
  })
);

router.delete(
  "/resources/:resourceId/save",
  authenticateToken,
  requireRoles("user"),
  validateParams(idSchema),
  asyncHandler(async (req, res) => {
    await pool.query(
      "DELETE FROM toolkit_resource_saves WHERE user_id=$1 AND resource_id=$2",
      [req.user.id, req.validatedParams.resourceId]
    );

    res.json({ success: true, message: "Resource removed from My Toolkit." });
  })
);

adminRouter.use(requireToolkitEnabled);
adminRouter.use(authenticateToken);
adminRouter.use(requireRoles("admin"));
adminRouter.use(requirePlatformOwner);

adminRouter.get(
  "/toolkit/resources",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `${resourceSelect}
       ORDER BY tr.updated_at DESC, tr.title ASC`
    );

    res.json({
      success: true,
      resources: result.rows.map((row) => mapResource(row, { includeContent: true })),
    });
  })
);

adminRouter.post(
  "/toolkit/resources",
  validateRequest(resourceBodySchema),
  asyncHandler(async (req, res) => {
    const body = req.validatedBody;
    const result = await pool.query(
      `INSERT INTO toolkit_resources(
        category_id,
        slug,
        title,
        description,
        resource_type,
        reading_time_minutes,
        preview_body,
        content_blocks,
        what_you_will_learn,
        status,
        published_at,
        created_by,
        updated_by
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $10='published' THEN NOW() ELSE NULL END,$11,$11)
      RETURNING *`,
      [
        body.categoryId,
        body.slug,
        body.title,
        body.description,
        body.resourceType,
        body.readingTimeMinutes,
        body.previewBody,
        JSON.stringify(body.contentBlocks),
        JSON.stringify(body.whatYouWillLearn),
        body.status,
        req.user.id,
      ]
    );

    await createAuditLog({
      actorUserId: req.user.id,
      action: "TOOLKIT_RESOURCE_CREATED",
      entityType: "toolkit_resource",
      entityId: result.rows[0].id,
      newValues: { title: body.title, status: body.status },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json({ success: true, resource: mapResource(result.rows[0], { includeContent: true }) });
  })
);

adminRouter.put(
  "/toolkit/resources/:resourceId",
  validateParams(idSchema),
  validateRequest(resourceBodySchema),
  asyncHandler(async (req, res) => {
    const body = req.validatedBody;
    const result = await pool.query(
      `UPDATE toolkit_resources
       SET
        category_id=$2,
        slug=$3,
        title=$4,
        description=$5,
        resource_type=$6,
        reading_time_minutes=$7,
        preview_body=$8,
        content_blocks=$9,
        what_you_will_learn=$10,
        status=$11,
        published_at=CASE
          WHEN $11='published' AND published_at IS NULL THEN NOW()
          WHEN $11='published' THEN published_at
          ELSE NULL
        END,
        updated_by=$12
       WHERE id=$1
       RETURNING *`,
      [
        req.validatedParams.resourceId,
        body.categoryId,
        body.slug,
        body.title,
        body.description,
        body.resourceType,
        body.readingTimeMinutes,
        body.previewBody,
        JSON.stringify(body.contentBlocks),
        JSON.stringify(body.whatYouWillLearn),
        body.status,
        req.user.id,
      ]
    );

    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: "Toolkit resource not found." });
    }

    await createAuditLog({
      actorUserId: req.user.id,
      action: "TOOLKIT_RESOURCE_UPDATED",
      entityType: "toolkit_resource",
      entityId: result.rows[0].id,
      newValues: { title: body.title, status: body.status },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({ success: true, resource: mapResource(result.rows[0], { includeContent: true }) });
  })
);

adminRouter.patch(
  "/toolkit/resources/:resourceId/status",
  validateParams(idSchema),
  validateRequest(statusBodySchema),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `UPDATE toolkit_resources
       SET
        status=$2,
        published_at=CASE
          WHEN $2='published' AND published_at IS NULL THEN NOW()
          WHEN $2='published' THEN published_at
          ELSE NULL
        END,
        updated_by=$3
       WHERE id=$1
       RETURNING *`,
      [req.validatedParams.resourceId, req.validatedBody.status, req.user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: "Toolkit resource not found." });
    }

    await createAuditLog({
      actorUserId: req.user.id,
      action: "TOOLKIT_RESOURCE_STATUS_CHANGED",
      entityType: "toolkit_resource",
      entityId: result.rows[0].id,
      newValues: { status: req.validatedBody.status },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.json({ success: true, resource: mapResource(result.rows[0], { includeContent: true }) });
  })
);

module.exports = {
  adminToolkitRoutes: adminRouter,
  toolkitRoutes: router,
};
