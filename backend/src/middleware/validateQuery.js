function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || "query",
        message: issue.message,
      }));

      return res.status(400).json({
        success: false,
        message: "Invalid query parameters.",
        errors,
      });
    }

    req.validatedQuery = result.data;
    next();
  };
}

module.exports = {
  validateQuery,
};