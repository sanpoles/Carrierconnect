BEGIN;

ALTER TABLE service_requests
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE service_requests
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

ALTER TABLE service_requests
ADD COLUMN IF NOT EXISTS locked_by UUID
REFERENCES users(id)
ON DELETE SET NULL;

ALTER TABLE service_requests
ADD COLUMN IF NOT EXISTS lock_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_service_requests_lock_status
ON service_requests(is_locked, status);

CREATE TABLE IF NOT EXISTS service_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    request_id UUID NOT NULL UNIQUE
        REFERENCES service_requests(id)
        ON DELETE CASCADE,

    sessions_granted INTEGER NOT NULL DEFAULT 0,
    sessions_consumed INTEGER NOT NULL DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'inactive',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT service_entitlements_granted_check
        CHECK (sessions_granted >= 0),

    CONSTRAINT service_entitlements_consumed_check
        CHECK (
            sessions_consumed >= 0
            AND sessions_consumed <= sessions_granted
        ),

    CONSTRAINT service_entitlements_status_check
        CHECK (status IN ('inactive', 'active', 'exhausted', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_service_entitlements_request_id
ON service_entitlements(request_id);

CREATE INDEX IF NOT EXISTS idx_service_entitlements_status
ON service_entitlements(status);

CREATE TABLE IF NOT EXISTS service_entitlement_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    entitlement_id UUID NOT NULL
        REFERENCES service_entitlements(id)
        ON DELETE CASCADE,

    request_id UUID NOT NULL
        REFERENCES service_requests(id)
        ON DELETE CASCADE,

    session_id UUID
        REFERENCES sessions(id)
        ON DELETE SET NULL,

    adjustment_type VARCHAR(50) NOT NULL,

    source VARCHAR(50) NOT NULL,

    sessions_delta INTEGER NOT NULL,

    reason TEXT,

    payment_provider VARCHAR(100),
    payment_reference_id VARCHAR(255),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_by_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT service_entitlement_adjustments_delta_check
        CHECK (sessions_delta <> 0)
);

ALTER TABLE service_entitlement_adjustments
ADD COLUMN IF NOT EXISTS session_id UUID
REFERENCES sessions(id)
ON DELETE SET NULL;

ALTER TABLE service_entitlement_adjustments
ADD COLUMN IF NOT EXISTS metadata JSONB
NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE service_entitlement_adjustments
DROP CONSTRAINT IF EXISTS service_entitlement_adjustments_type_check;

ALTER TABLE service_entitlement_adjustments
DROP CONSTRAINT IF EXISTS service_entitlement_adjustments_adjustment_type_check;

ALTER TABLE service_entitlement_adjustments
ADD CONSTRAINT service_entitlement_adjustments_adjustment_type_check
CHECK (
    adjustment_type IN (
        'initial_grant',
        'manual_grant',
        'manual_reduction',
        'payment_grant',
        'promotion_grant',
        'refund_reduction',
        'session_consumed',
        'admin_override'
    )
);

ALTER TABLE service_entitlement_adjustments
DROP CONSTRAINT IF EXISTS service_entitlement_adjustments_source_check;

ALTER TABLE service_entitlement_adjustments
ADD CONSTRAINT service_entitlement_adjustments_source_check
CHECK (
    source IN (
        'admin_manual',
        'payment',
        'promotion',
        'adjustment',
        'system',
        'migration'
    )
);

CREATE INDEX IF NOT EXISTS idx_entitlement_adjustments_request_created
ON service_entitlement_adjustments(request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_entitlement_adjustments_entitlement_created
ON service_entitlement_adjustments(entitlement_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_entitlement_adjustments_session
ON service_entitlement_adjustments(session_id)
WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_entitlement_session_consumed
ON service_entitlement_adjustments(session_id)
WHERE
    session_id IS NOT NULL
    AND adjustment_type = 'session_consumed';

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_entitlement_reference
ON service_entitlement_adjustments(
    payment_provider,
    payment_reference_id
)
WHERE
    payment_provider IS NOT NULL
    AND payment_reference_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_service_entitlements_updated_at
ON service_entitlements;

CREATE TRIGGER trg_service_entitlements_updated_at
BEFORE UPDATE ON service_entitlements
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION create_default_service_entitlement()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO service_entitlements (
        request_id,
        sessions_granted,
        sessions_consumed,
        status
    )
    VALUES (
        NEW.id,
        0,
        0,
        'inactive'
    )
    ON CONFLICT (request_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_default_service_entitlement
ON service_requests;

CREATE TRIGGER trg_create_default_service_entitlement
AFTER INSERT ON service_requests
FOR EACH ROW
EXECUTE FUNCTION create_default_service_entitlement();

INSERT INTO service_entitlements (
    request_id,
    sessions_granted,
    sessions_consumed,
    status
)
SELECT
    sr.id,

    (
        SELECT COUNT(*)
        FROM sessions s
        WHERE s.request_id = sr.id
          AND s.status IN (
              'scheduled',
              'reschedule_requested',
              'completed'
          )
    ) AS sessions_granted,

    (
        SELECT COUNT(*)
        FROM sessions s
        WHERE s.request_id = sr.id
          AND s.status = 'completed'
    ) AS sessions_consumed,

    CASE
        WHEN sr.status IN ('completed', 'closed', 'cancelled')
            THEN 'exhausted'

        WHEN (
            SELECT COUNT(*)
            FROM sessions s
            WHERE s.request_id = sr.id
              AND s.status IN (
                  'scheduled',
                  'reschedule_requested',
                  'completed'
              )
        ) >
        (
            SELECT COUNT(*)
            FROM sessions s
            WHERE s.request_id = sr.id
              AND s.status = 'completed'
        )
            THEN 'active'

        WHEN (
            SELECT COUNT(*)
            FROM sessions s
            WHERE s.request_id = sr.id
              AND s.status = 'completed'
        ) > 0
            THEN 'exhausted'

        ELSE 'inactive'
    END
FROM service_requests sr
ON CONFLICT (request_id) DO NOTHING;

UPDATE service_requests
SET
    is_locked = TRUE,
    locked_at = COALESCE(locked_at, NOW()),
    lock_reason = COALESCE(
        lock_reason,
        'Historical request was already completed, closed, or cancelled before entitlement controls were introduced.'
    )
WHERE status IN ('completed', 'closed', 'cancelled')
  AND is_locked = FALSE;

COMMIT;

SELECT
    'Engagement entitlement and request-locking schema created successfully.'
    AS result;