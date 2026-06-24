function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || "params",
        message: issue.message,
      }));

      return res.status(400).json({
        success: false,
        message: "Invalid request parameters.",
        errors,
      });
    }

    req.validatedParams = result.data;
    next();
  };
}

module.exports = {
  validateParams,
};