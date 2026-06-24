BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE counsellor_profiles
  ADD COLUMN IF NOT EXISTS availability_timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS default_session_duration_minutes INTEGER NOT NULL DEFAULT 60,
  ADD CONSTRAINT counsellor_profile_duration_check CHECK (default_session_duration_minutes BETWEEN 15 AND 180);

CREATE TABLE IF NOT EXISTS user_career_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  professional_summary TEXT,
  current_job_title VARCHAR(150),
  industry VARCHAR(150),
  years_of_experience INTEGER,
  target_role VARCHAR(150),
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  career_goals TEXT,
  linkedin_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_career_profile_experience_check CHECK (years_of_experience IS NULL OR years_of_experience BETWEEN 0 AND 60)
);

CREATE TABLE IF NOT EXISTS user_resume_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_file_name VARCHAR(255) NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type VARCHAR(150) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_resume_documents_current ON user_resume_documents(user_id) WHERE is_current = TRUE;

CREATE TABLE IF NOT EXISTS counsellor_availability_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT counsellor_availability_window_time_check CHECK (end_time > start_time),
  CONSTRAINT ux_counsellor_availability_day UNIQUE(counsellor_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS counsellor_unavailability_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT counsellor_unavailability_time_check CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_counsellor_unavailability_blocks_range ON counsellor_unavailability_blocks(counsellor_id, starts_at, ends_at);

COMMIT;
