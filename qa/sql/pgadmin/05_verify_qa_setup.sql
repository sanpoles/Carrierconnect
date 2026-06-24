-- CareerConnect QA setup verification for pgAdmin Query Tool.
-- Run while connected to the careerconnect_qa database.

SELECT
  current_database() AS database_name,
  CASE
    WHEN current_database() = 'careerconnect_qa' THEN 'ok'
    ELSE 'wrong_database'
  END AS database_check;

SELECT
  email,
  full_name,
  role,
  admin_scope,
  is_active,
  email_verified
FROM users
WHERE email IN (
  'qa.user@careerconnect.test',
  'qa.counsellor@careerconnect.test',
  'qa.operational.admin@careerconnect.test',
  'qa.platform.owner@careerconnect.test'
)
ORDER BY email;

SELECT
  COUNT(*) AS qa_account_count
FROM users
WHERE email IN (
  'qa.user@careerconnect.test',
  'qa.counsellor@careerconnect.test',
  'qa.operational.admin@careerconnect.test',
  'qa.platform.owner@careerconnect.test'
);

SELECT
  u.email,
  CASE WHEN ucp.user_id IS NULL THEN 'missing' ELSE 'exists' END AS career_profile_check
FROM users u
LEFT JOIN user_career_profiles ucp ON ucp.user_id = u.id
WHERE u.email = 'qa.user@careerconnect.test';

SELECT
  u.email,
  CASE WHEN cp.user_id IS NULL THEN 'missing' ELSE 'exists' END AS counsellor_profile_check,
  cp.is_available,
  cp.availability_timezone,
  cp.default_session_duration_minutes,
  COUNT(caw.id) AS availability_window_count
FROM users u
LEFT JOIN counsellor_profiles cp ON cp.user_id = u.id
LEFT JOIN counsellor_availability_windows caw ON caw.counsellor_id = u.id
WHERE u.email = 'qa.counsellor@careerconnect.test'
GROUP BY
  u.email,
  cp.user_id,
  cp.is_available,
  cp.availability_timezone,
  cp.default_session_duration_minutes;

SELECT
  email,
  role,
  admin_scope,
  CASE
    WHEN email = 'qa.operational.admin@careerconnect.test'
      AND role = 'admin'
      AND admin_scope = 'operational'
      THEN 'ok'
    WHEN email = 'qa.platform.owner@careerconnect.test'
      AND role = 'admin'
      AND admin_scope = 'platform_owner'
      THEN 'ok'
    ELSE 'unexpected'
  END AS admin_scope_check
FROM users
WHERE email IN (
  'qa.operational.admin@careerconnect.test',
  'qa.platform.owner@careerconnect.test'
)
ORDER BY email;
