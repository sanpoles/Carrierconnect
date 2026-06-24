const bcrypt = require("bcryptjs");

const env = require("../src/config/env");
const { pool } = require("../src/db/pool");

async function createDemoCounsellor() {
  const fullName =
    process.env.DEMO_COUNSELLOR_FULL_NAME || "Demo Career Counsellor";

  const email =
    process.env.DEMO_COUNSELLOR_EMAIL || "counsellor@careerconnect.local";

  const password =
    process.env.DEMO_COUNSELLOR_PASSWORD || "DemoCounsellor123!";

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const existingUserResult = await pool.query(
      `
        SELECT id, role
        FROM users
        WHERE email = $1
      `,
      [normalizedEmail]
    );

    let counsellorId;

    if (existingUserResult.rowCount > 0) {
      const existingUser = existingUserResult.rows[0];

      counsellorId = existingUser.id;

      await pool.query(
        `
          UPDATE users
          SET
            role = 'counsellor',
            is_active = true,
            email_verified = true
          WHERE id = $1
        `,
        [counsellorId]
      );
    } else {
      const passwordHash = await bcrypt.hash(password, 12);

      const newCounsellorResult = await pool.query(
        `
          INSERT INTO users (
            full_name,
            email,
            password_hash,
            role,
            email_verified,
            is_active
          )
          VALUES ($1, $2, $3, 'counsellor', true, true)
          RETURNING id
        `,
        [fullName, normalizedEmail, passwordHash]
      );

      counsellorId = newCounsellorResult.rows[0].id;
    }

    await pool.query(
      `
        INSERT INTO counsellor_profiles (
          user_id,
          headline,
          biography,
          years_of_experience,
          specializations,
          languages,
          is_available
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6::jsonb,
          true
        )
        ON CONFLICT (user_id)
        DO UPDATE SET
          headline = EXCLUDED.headline,
          biography = EXCLUDED.biography,
          years_of_experience = EXCLUDED.years_of_experience,
          specializations = EXCLUDED.specializations,
          languages = EXCLUDED.languages,
          is_available = true
      `,
      [
        counsellorId,
        "Career Transition and Interview Coach",
        "Development-only counsellor profile for testing CareerConnect workflows.",
        10,
        JSON.stringify([
          "Career Transition",
          "Technical Project Management",
          "Mock Interviews",
          "IT Leadership",
        ]),
        JSON.stringify(["English"]),
      ]
    );

    console.log("\nDemo counsellor is ready.");
    console.log(`Email: ${normalizedEmail}`);
    console.log(`Password: ${password}`);
    console.log(`User ID: ${counsellorId}\n`);
  } catch (error) {
    console.error("Unable to create demo counsellor:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

createDemoCounsellor();