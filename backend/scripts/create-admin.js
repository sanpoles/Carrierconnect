const bcrypt = require("bcryptjs");

const env = require("../src/config/env");
const { pool } = require("../src/db/pool");

async function createAdminUser() {
  try {
    if (
      !env.admin.fullName ||
      !env.admin.email ||
      !env.admin.password
    ) {
      throw new Error(
        "ADMIN_FULL_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD must be configured in .env"
      );
    }

    if (env.admin.password.length < 12) {
      throw new Error(
        "ADMIN_PASSWORD must contain at least 12 characters."
      );
    }

    const email = env.admin.email.trim().toLowerCase();

    const existingAdmin = await pool.query(
      "SELECT id, email, role FROM users WHERE email = $1",
      [email]
    );

    if (existingAdmin.rowCount > 0) {
      console.log(
        `A user already exists with ${email}. No new administrator was created.`
      );
      return;
    }

    const passwordHash = await bcrypt.hash(env.admin.password, 12);

    const result = await pool.query(
      `
        INSERT INTO users (
          full_name,
          email,
          password_hash,
          role,
          email_verified
        )
        VALUES ($1, $2, $3, 'admin', true)
        RETURNING id, full_name, email, role, created_at
      `,
      [
        env.admin.fullName.trim(),
        email,
        passwordHash,
      ]
    );

    console.log("Administrator created successfully:");
    console.table(result.rows);
  } catch (error) {
    console.error("Unable to create administrator:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

createAdminUser();