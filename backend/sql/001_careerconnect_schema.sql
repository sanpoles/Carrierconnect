CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('user', 'counsellor', 'admin');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_type') THEN
        CREATE TYPE request_type AS ENUM ('career_counselling', 'mock_interview');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_status') THEN
        CREATE TYPE request_status AS ENUM (
            'submitted',
            'assigned',
            'in_progress',
            'session_scheduled',
            'completed',
            'cancelled',
            'closed'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
        CREATE TYPE session_status AS ENUM (
            'scheduled',
            'reschedule_requested',
            'cancelled',
            'completed',
            'no_show'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_sender_type') THEN
        CREATE TYPE message_sender_type AS ENUM (
            'user',
            'counsellor',
            'admin',
            'system'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE notification_type AS ENUM (
            'request_submitted',
            'request_assigned',
            'message_received',
            'session_scheduled',
            'meeting_link_changed',
            'session_rescheduled',
            'session_cancelled',
            'session_reminder',
            'session_completed',
            'feedback_requested',
            'general'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'counsellor_application_status') THEN
        CREATE TYPE counsellor_application_status AS ENUM (
            'submitted',
            'under_review',
            'approved',
            'rejected',
            'withdrawn'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'user',
    phone VARCHAR(30),
    profile_photo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS counsellor_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    headline VARCHAR(250),
    biography TEXT,
    years_of_experience INTEGER,
    specializations JSONB NOT NULL DEFAULT '[]'::jsonb,
    languages JSONB NOT NULL DEFAULT '[]'::jsonb,
    linkedin_url TEXT,
    resume_url TEXT,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT counsellor_profile_experience_check
        CHECK (years_of_experience IS NULL OR years_of_experience >= 0)
);

CREATE TABLE IF NOT EXISTS counsellor_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    applicant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    headline VARCHAR(250),
    biography TEXT NOT NULL,
    years_of_experience INTEGER,
    specializations JSONB NOT NULL DEFAULT '[]'::jsonb,
    languages JSONB NOT NULL DEFAULT '[]'::jsonb,
    linkedin_url TEXT,
    resume_url TEXT,
    status counsellor_application_status NOT NULL DEFAULT 'submitted',
    admin_notes TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT counsellor_application_experience_check
        CHECK (years_of_experience IS NULL OR years_of_experience >= 0)
);

CREATE INDEX IF NOT EXISTS idx_counsellor_applications_status
    ON counsellor_applications(status);

CREATE TABLE IF NOT EXISTS service_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number VARCHAR(30) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_counsellor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    request_type request_type NOT NULL,
    status request_status NOT NULL DEFAULT 'submitted',

    title VARCHAR(250) NOT NULL,
    description TEXT NOT NULL,

    industry VARCHAR(150),
    current_job_title VARCHAR(150),
    years_of_experience INTEGER,
    target_role VARCHAR(150),
    skills JSONB NOT NULL DEFAULT '[]'::jsonb,

    preferred_date DATE,
    preferred_time_slot VARCHAR(100),
    timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',

    resume_url TEXT,
    additional_details JSONB NOT NULL DEFAULT '{}'::jsonb,

    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT service_request_experience_check
        CHECK (years_of_experience IS NULL OR years_of_experience >= 0)
);

CREATE INDEX IF NOT EXISTS idx_service_requests_user_id
    ON service_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_service_requests_assigned_counsellor
    ON service_requests(assigned_counsellor_id);

CREATE INDEX IF NOT EXISTS idx_service_requests_status
    ON service_requests(status);

CREATE INDEX IF NOT EXISTS idx_service_requests_type
    ON service_requests(request_type);

CREATE TABLE IF NOT EXISTS request_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sender_type message_sender_type NOT NULL,
    message_body TEXT NOT NULL,
    is_internal BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_messages_request_id_created_at
    ON request_messages(request_id, created_at);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    counsellor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    title VARCHAR(250) NOT NULL,
    scheduled_start_at TIMESTAMPTZ NOT NULL,
    scheduled_end_at TIMESTAMPTZ NOT NULL,
    timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',

    meeting_provider VARCHAR(100) DEFAULT 'Zoom',
    meeting_link TEXT,
    meeting_link_updated_at TIMESTAMPTZ,

    status session_status NOT NULL DEFAULT 'scheduled',
    reschedule_reason TEXT,
    cancellation_reason TEXT,
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    reminder_sent_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sessions_time_check
        CHECK (scheduled_end_at > scheduled_start_at)
);

CREATE INDEX IF NOT EXISTS idx_sessions_request_id ON sessions(request_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_counsellor_id ON sessions(counsellor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(scheduled_start_at);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

CREATE TABLE IF NOT EXISTS session_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    counsellor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    rating SMALLINT NOT NULL,
    comments TEXT,
    allow_testimonial BOOLEAN NOT NULL DEFAULT FALSE,
    testimonial_approved BOOLEAN NOT NULL DEFAULT FALSE,
    testimonial_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    testimonial_approved_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT session_feedback_rating_check
        CHECK (rating BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_session_feedback_counsellor_id
    ON session_feedback(counsellor_id);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id UUID REFERENCES service_requests(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,

    notification_type notification_type NOT NULL,
    title VARCHAR(250) NOT NULL,
    message TEXT NOT NULL,
    action_url TEXT,

    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications(user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS email_notification_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    request_id UUID REFERENCES service_requests(id) ON DELETE SET NULL,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,

    notification_type notification_type NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    provider_message_id VARCHAR(255),

    delivery_status VARCHAR(50) NOT NULL DEFAULT 'queued',
    error_message TEXT,

    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_history_recipient
    ON email_notification_history(recipient_email, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(150) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    request_id UUID REFERENCES service_requests(id) ON DELETE SET NULL,

    old_values JSONB,
    new_values JSONB,

    ip_address VARCHAR(100),
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
    ON audit_logs(entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
    ON audit_logs(actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_counsellor_profiles_updated_at ON counsellor_profiles;
CREATE TRIGGER trg_counsellor_profiles_updated_at
BEFORE UPDATE ON counsellor_profiles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_counsellor_applications_updated_at ON counsellor_applications;
CREATE TRIGGER trg_counsellor_applications_updated_at
BEFORE UPDATE ON counsellor_applications
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_service_requests_updated_at ON service_requests;
CREATE TRIGGER trg_service_requests_updated_at
BEFORE UPDATE ON service_requests
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sessions_updated_at ON sessions;
CREATE TRIGGER trg_sessions_updated_at
BEFORE UPDATE ON sessions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_session_feedback_updated_at ON session_feedback;
CREATE TRIGGER trg_session_feedback_updated_at
BEFORE UPDATE ON session_feedback
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

SELECT 'CareerConnect schema created successfully.' AS result;