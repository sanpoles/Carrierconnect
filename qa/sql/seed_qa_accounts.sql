-- CareerConnect deterministic QA seed accounts.
-- Run only against the careerconnect_qa database.
--
-- Passwords:
-- qa.user@careerconnect.test              / QaUserPassword123
-- qa.counsellor@careerconnect.test        / QaCounsellorPassword123
-- qa.operational.admin@careerconnect.test / QaOpsAdminPassword123
-- qa.platform.owner@careerconnect.test    / QaOwnerPassword123

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'careerconnect_qa' THEN
    RAISE EXCEPTION 'Refusing to seed %. Use careerconnect_qa only.', current_database();
  END IF;
END $$;

BEGIN;

INSERT INTO users (
  full_name,
  email,
  password_hash,
  role,
  admin_scope,
  phone,
  is_active,
  email_verified
)
VALUES
  (
    'QA Career User',
    'qa.user@careerconnect.test',
    '$2b$12$7c.L7Hlqpns.GmsvgCZQ5uctJNgxoL2PFjHUF1Or2xuYygAUHSt6a',
    'user',
    NULL,
    '+15550001001',
    TRUE,
    TRUE
  ),
  (
    'QA Career Counsellor',
    'qa.counsellor@careerconnect.test',
    '$2b$12$NOBZuI7RyRXEwt8iFuaNP.01YmPscYCNqQXc1ODPehzCV6YVKrolq',
    'counsellor',
    NULL,
    '+15550001002',
    TRUE,
    TRUE
  ),
  (
    'QA Operational Admin',
    'qa.operational.admin@careerconnect.test',
    '$2b$12$nSji.v69sHlOO6hhXLW7fuloW8YL3qD6wkJBaJVx7wQt/Z6sZ9Phy',
    'admin',
    'operational',
    '+15550001003',
    TRUE,
    TRUE
  ),
  (
    'QA Platform Owner',
    'qa.platform.owner@careerconnect.test',
    '$2b$12$VbAzgoMzA6SYrPi3chGtaOLmMY08ZbLOfGwZ.26KlnZXHqBLZ.DIC',
    'admin',
    'platform_owner',
    '+15550001004',
    TRUE,
    TRUE
  )
ON CONFLICT (email)
DO UPDATE SET
  full_name = EXCLUDED.full_name,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  admin_scope = EXCLUDED.admin_scope,
  phone = EXCLUDED.phone,
  is_active = TRUE,
  email_verified = TRUE,
  auth_version = users.auth_version + 1,
  updated_at = NOW();

INSERT INTO counsellor_profiles (
  user_id,
  headline,
  biography,
  years_of_experience,
  specializations,
  languages,
  is_available,
  availability_timezone,
  default_session_duration_minutes
)
SELECT
  id,
  'QA Career Transition Coach',
  'CAREERCONNECT_QA_E2E counsellor profile for local E2E smoke tests.',
  10,
  '["Career Transition", "Mock Interviews", "Career Planning"]'::jsonb,
  '["English"]'::jsonb,
  TRUE,
  'Asia/Kolkata',
  60
FROM users
WHERE email = 'qa.counsellor@careerconnect.test'
ON CONFLICT (user_id)
DO UPDATE SET
  headline = EXCLUDED.headline,
  biography = EXCLUDED.biography,
  years_of_experience = EXCLUDED.years_of_experience,
  specializations = EXCLUDED.specializations,
  languages = EXCLUDED.languages,
  is_available = TRUE,
  availability_timezone = EXCLUDED.availability_timezone,
  default_session_duration_minutes = EXCLUDED.default_session_duration_minutes;

INSERT INTO user_career_profiles (
  user_id,
  professional_summary,
  current_job_title,
  industry,
  years_of_experience,
  target_role,
  skills,
  career_goals,
  linkedin_url
)
SELECT
  id,
  'CAREERCONNECT_QA_E2E user profile for local E2E smoke tests.',
  'QA Analyst',
  'Technology',
  5,
  'Senior QA Analyst',
  '["Testing", "Automation", "Career Planning"]'::jsonb,
  'Validate CareerConnect smoke workflows with isolated QA data.',
  ''
FROM users
WHERE email = 'qa.user@careerconnect.test'
ON CONFLICT (user_id)
DO UPDATE SET
  professional_summary = EXCLUDED.professional_summary,
  current_job_title = EXCLUDED.current_job_title,
  industry = EXCLUDED.industry,
  years_of_experience = EXCLUDED.years_of_experience,
  target_role = EXCLUDED.target_role,
  skills = EXCLUDED.skills,
  career_goals = EXCLUDED.career_goals,
  linkedin_url = EXCLUDED.linkedin_url,
  updated_at = NOW();

INSERT INTO counsellor_availability_windows (
  counsellor_id,
  day_of_week,
  start_time,
  end_time,
  is_enabled
)
SELECT
  users.id,
  days.day_of_week,
  '09:00'::time,
  '17:00'::time,
  TRUE
FROM users
CROSS JOIN (
  VALUES (1), (2), (3), (4), (5)
) AS days(day_of_week)
WHERE users.email = 'qa.counsellor@careerconnect.test'
ON CONFLICT (counsellor_id, day_of_week)
DO UPDATE SET
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  is_enabled = TRUE,
  updated_at = NOW();

COMMIT;
