BEGIN;

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'counsellor_message';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'counsellor_internal_note';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'session_alternatives_proposed';

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS scheduling_status VARCHAR(40) NOT NULL DEFAULT 'requested_preferences',
  ADD COLUMN IF NOT EXISTS scheduling_status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_scheduling_status_check
    CHECK (scheduling_status IN (
      'requested_preferences',
      'counsellor_review',
      'alternative_slots_proposed',
      'user_slot_selected',
      'confirmed'
    ));

CREATE TABLE IF NOT EXISTS service_request_preferred_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_start_at TIMESTAMPTZ NOT NULL,
  scheduled_end_at TIMESTAMPTZ NOT NULL,
  timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
  display_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_request_preferred_slots_order_check CHECK (display_order BETWEEN 1 AND 3),
  CONSTRAINT service_request_preferred_slots_future_check CHECK (scheduled_start_at > created_at),
  CONSTRAINT service_request_preferred_slots_end_check CHECK (scheduled_end_at > scheduled_start_at),
  CONSTRAINT service_request_preferred_slots_unique_order UNIQUE (request_id, display_order),
  CONSTRAINT service_request_preferred_slots_unique_slot UNIQUE (request_id, scheduled_start_at, scheduled_end_at)
);

CREATE INDEX IF NOT EXISTS idx_service_request_preferred_slots_request
  ON service_request_preferred_slots(request_id, display_order);

CREATE TABLE IF NOT EXISTS session_slot_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  counsellor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'proposed',
  selected_option_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT session_slot_proposals_status_check CHECK (status IN ('proposed', 'selected', 'confirmed', 'cancelled', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_session_slot_proposals_request
  ON session_slot_proposals(request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS session_slot_proposal_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES session_slot_proposals(id) ON DELETE CASCADE,
  scheduled_start_at TIMESTAMPTZ NOT NULL,
  scheduled_end_at TIMESTAMPTZ NOT NULL,
  timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
  display_order INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'proposed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT session_slot_proposal_options_order_check CHECK (display_order BETWEEN 1 AND 3),
  CONSTRAINT session_slot_proposal_options_future_check CHECK (scheduled_start_at > created_at),
  CONSTRAINT session_slot_proposal_options_end_check CHECK (scheduled_end_at > scheduled_start_at),
  CONSTRAINT session_slot_proposal_options_status_check CHECK (status IN ('proposed', 'selected', 'confirmed', 'unavailable', 'cancelled')),
  CONSTRAINT session_slot_proposal_options_unique_order UNIQUE (proposal_id, display_order),
  CONSTRAINT session_slot_proposal_options_unique_slot UNIQUE (proposal_id, scheduled_start_at, scheduled_end_at)
);

ALTER TABLE session_slot_proposals
  ADD CONSTRAINT session_slot_proposals_selected_option_fk
    FOREIGN KEY (selected_option_id)
    REFERENCES session_slot_proposal_options(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_session_slot_proposal_options_proposal
  ON session_slot_proposal_options(proposal_id, display_order);

COMMIT;
