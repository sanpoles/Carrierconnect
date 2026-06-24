BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organization_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_name VARCHAR(200) NOT NULL,
  contact_name VARCHAR(150) NOT NULL,
  work_email VARCHAR(320) NOT NULL,
  phone VARCHAR(50),
  country_or_region VARCHAR(120),
  organization_size VARCHAR(80),
  support_area VARCHAR(120) NOT NULL,
  target_audience VARCHAR(160),
  expected_scope VARCHAR(160),
  desired_timeline VARCHAR(160),
  current_challenge TEXT NOT NULL,
  success_outcome TEXT,
  preferred_discussion_time VARCHAR(160),
  contact_preference VARCHAR(40) NOT NULL DEFAULT 'email',
  status VARCHAR(40) NOT NULL DEFAULT 'new',
  admin_notes TEXT,
  contacted_at TIMESTAMPTZ,
  discovery_scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_inquiries_status_check
    CHECK (status IN ('new','contacted','discovery_scheduled','proposal_sent','won','not_proceeding')),
  CONSTRAINT organization_inquiries_contact_preference_check
    CHECK (contact_preference IN ('email','phone','either'))
);

CREATE INDEX IF NOT EXISTS idx_organization_inquiries_status_created
  ON organization_inquiries(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_organization_inquiries_work_email
  ON organization_inquiries(work_email);

COMMIT;
