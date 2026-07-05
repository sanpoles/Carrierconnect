function validateRequest(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || "body",
        message: issue.message,
      }));

      return res.status(400).json({
        success: false,
        message: errors[0]?.message || "Validation failed.",
        errors,
      });
    }

    req.validatedBody = result.data;
    next();
  };
}

module.exports = {
  validateRequest,
};
