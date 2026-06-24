-- CareerConnect test data: engagement-status scenarios
-- TEST ONLY. This script creates records whose title begins with [TEST].
-- Your database automatically creates a service_entitlements row when a request is inserted.
-- This version UPSERTS the entitlement snapshot and uses valid 45-minute session end times.
-- It is safe to re-run: it first deletes only the test records created by this script.
-- Run this in pgAdmin Query Tool while connected to the CareerConnect database.

BEGIN;

-- Remove prior copies of this test set. Production records are not touched.
DELETE FROM audit_logs
WHERE request_id IN (
  SELECT id FROM service_requests WHERE title LIKE '[TEST] Engagement status:%'
);

DELETE FROM notifications
WHERE request_id IN (
  SELECT id FROM service_requests WHERE title LIKE '[TEST] Engagement status:%'
);

DELETE FROM request_messages
WHERE request_id IN (
  SELECT id FROM service_requests WHERE title LIKE '[TEST] Engagement status:%'
);

DELETE FROM service_entitlement_adjustments
WHERE request_id IN (
  SELECT id FROM service_requests WHERE title LIKE '[TEST] Engagement status:%'
);

DELETE FROM sessions
WHERE request_id IN (
  SELECT id FROM service_requests WHERE title LIKE '[TEST] Engagement status:%'
);

DELETE FROM service_entitlements
WHERE request_id IN (
  SELECT id FROM service_requests WHERE title LIKE '[TEST] Engagement status:%'
);

DELETE FROM service_requests
WHERE title LIKE '[TEST] Engagement status:%';

DO $$
DECLARE
  v_user_id uuid;
  v_counsellor_id uuid;
  v_now timestamptz := NOW();

  v_awaiting_assignment uuid := md5('careerconnect-test-awaiting-assignment')::uuid;
  v_awaiting_entitlement uuid := md5('careerconnect-test-awaiting-entitlement')::uuid;
  v_ready_to_start uuid := md5('careerconnect-test-ready-to-start')::uuid;
  v_active uuid := md5('careerconnect-test-active')::uuid;
  v_exhausted uuid := md5('careerconnect-test-exhausted')::uuid;
  v_manual_lock uuid := md5('careerconnect-test-manual-lock')::uuid;
BEGIN
  SELECT id
  INTO v_user_id
  FROM users
  WHERE role = 'user'
    AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  SELECT u.id
  INTO v_counsellor_id
  FROM users u
  INNER JOIN counsellor_profiles cp ON cp.user_id = u.id
  WHERE u.role = 'counsellor'
    AND u.is_active = true
    AND cp.is_available = true
  ORDER BY u.created_at ASC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Seed stopped: no active user account is available.';
  END IF;

  IF v_counsellor_id IS NULL THEN
    RAISE EXCEPTION 'Seed stopped: no active and available counsellor account is available.';
  END IF;

  -- A. No counsellor, no approval: Awaiting assignment.
  INSERT INTO service_requests (
    id, request_number, user_id, assigned_counsellor_id,
    request_type, status, title, description,
    timezone, submitted_at, created_at, updated_at,
    is_locked, locked_at, locked_by, lock_reason
  ) VALUES (
    v_awaiting_assignment, 'TEST-AWAIT-ASSIGN', v_user_id, NULL,
    'career_counselling', 'submitted',
    '[TEST] Engagement status: Awaiting assignment',
    'Test scenario: sessions may be approved later, but no counsellor is currently assigned.',
    'Asia/Kolkata', v_now - INTERVAL '6 days', v_now - INTERVAL '6 days', v_now,
    false, NULL, NULL, NULL
  );

  INSERT INTO service_entitlements (request_id, sessions_granted, sessions_consumed, status)
  VALUES (v_awaiting_assignment, 0, 0, 'inactive')
  ON CONFLICT (request_id) DO UPDATE
  SET sessions_granted = EXCLUDED.sessions_granted,
      sessions_consumed = EXCLUDED.sessions_consumed,
      status = EXCLUDED.status,
      updated_at = NOW();

  -- B. Counsellor assigned, but zero approved sessions: Awaiting entitlement.
  INSERT INTO service_requests (
    id, request_number, user_id, assigned_counsellor_id,
    request_type, status, title, description,
    timezone, submitted_at, assigned_at, created_at, updated_at,
    is_locked, locked_at, locked_by, lock_reason
  ) VALUES (
    v_awaiting_entitlement, 'TEST-AWAIT-ENTITLE', v_user_id, v_counsellor_id,
    'mock_interview', 'assigned',
    '[TEST] Engagement status: Awaiting entitlement',
    'Test scenario: counsellor is assigned, but administrator has approved zero sessions.',
    'Asia/Kolkata', v_now - INTERVAL '5 days', v_now - INTERVAL '4 days', v_now - INTERVAL '5 days', v_now,
    false, NULL, NULL, NULL
  );

  INSERT INTO service_entitlements (request_id, sessions_granted, sessions_consumed, status)
  VALUES (v_awaiting_entitlement, 0, 0, 'inactive')
  ON CONFLICT (request_id) DO UPDATE
  SET sessions_granted = EXCLUDED.sessions_granted,
      sessions_consumed = EXCLUDED.sessions_consumed,
      status = EXCLUDED.status,
      updated_at = NOW();

  -- C. Counsellor + approved sessions, no session booked yet: Ready to start.
  INSERT INTO service_requests (
    id, request_number, user_id, assigned_counsellor_id,
    request_type, status, title, description,
    timezone, submitted_at, assigned_at, created_at, updated_at,
    is_locked, locked_at, locked_by, lock_reason
  ) VALUES (
    v_ready_to_start, 'TEST-READY-START', v_user_id, v_counsellor_id,
    'career_counselling', 'assigned',
    '[TEST] Engagement status: Ready to start',
    'Test scenario: counsellor assigned and three sessions approved; no session has started yet.',
    'Asia/Kolkata', v_now - INTERVAL '4 days', v_now - INTERVAL '3 days', v_now - INTERVAL '4 days', v_now,
    false, NULL, NULL, NULL
  );

  INSERT INTO service_entitlements (request_id, sessions_granted, sessions_consumed, status)
  VALUES (v_ready_to_start, 3, 0, 'active')
  ON CONFLICT (request_id) DO UPDATE
  SET sessions_granted = EXCLUDED.sessions_granted,
      sessions_consumed = EXCLUDED.sessions_consumed,
      status = EXCLUDED.status,
      updated_at = NOW();

  -- D. Active engagement with a future scheduled session.
  INSERT INTO service_requests (
    id, request_number, user_id, assigned_counsellor_id,
    request_type, status, title, description,
    timezone, submitted_at, assigned_at, created_at, updated_at,
    is_locked, locked_at, locked_by, lock_reason
  ) VALUES (
    v_active, 'TEST-ACTIVE', v_user_id, v_counsellor_id,
    'mock_interview', 'session_scheduled',
    '[TEST] Engagement status: Active',
    'Test scenario: one of three approved sessions is scheduled in the future.',
    'Asia/Kolkata', v_now - INTERVAL '3 days', v_now - INTERVAL '2 days', v_now - INTERVAL '3 days', v_now,
    false, NULL, NULL, NULL
  );

  INSERT INTO service_entitlements (request_id, sessions_granted, sessions_consumed, status)
  VALUES (v_active, 3, 0, 'active')
  ON CONFLICT (request_id) DO UPDATE
  SET sessions_granted = EXCLUDED.sessions_granted,
      sessions_consumed = EXCLUDED.sessions_consumed,
      status = EXCLUDED.status,
      updated_at = NOW();

  INSERT INTO sessions (
    request_id, user_id, counsellor_id, title,
    scheduled_start_at, scheduled_end_at, timezone,
    meeting_provider, meeting_link, status, created_at, updated_at
  ) VALUES (
    v_active, v_user_id, v_counsellor_id, 'TEST Active planning session',
    v_now + INTERVAL '2 days', v_now + INTERVAL '2 days 45 minutes', 'Asia/Kolkata',
    'Zoom', 'https://example.invalid/careerconnect-test-active', 'scheduled', v_now, v_now
  );

  -- E. All approved sessions consumed: Exhausted / completed / locked.
  INSERT INTO service_requests (
    id, request_number, user_id, assigned_counsellor_id,
    request_type, status, title, description,
    timezone, submitted_at, assigned_at, completed_at, created_at, updated_at,
    is_locked, locked_at, locked_by, lock_reason
  ) VALUES (
    v_exhausted, 'TEST-EXHAUSTED', v_user_id, v_counsellor_id,
    'career_counselling', 'completed',
    '[TEST] Engagement status: Exhausted',
    'Test scenario: two approved sessions were completed and no sessions remain.',
    'Asia/Kolkata', v_now - INTERVAL '20 days', v_now - INTERVAL '19 days', v_now - INTERVAL '2 days', v_now - INTERVAL '20 days', v_now,
    true, v_now - INTERVAL '2 days', NULL, 'All approved sessions have been delivered.'
  );

  INSERT INTO service_entitlements (request_id, sessions_granted, sessions_consumed, status)
  VALUES (v_exhausted, 2, 2, 'exhausted')
  ON CONFLICT (request_id) DO UPDATE
  SET sessions_granted = EXCLUDED.sessions_granted,
      sessions_consumed = EXCLUDED.sessions_consumed,
      status = EXCLUDED.status,
      updated_at = NOW();

  INSERT INTO sessions (
    request_id, user_id, counsellor_id, title,
    scheduled_start_at, scheduled_end_at, timezone,
    meeting_provider, status, completed_at, created_at, updated_at
  ) VALUES
    (v_exhausted, v_user_id, v_counsellor_id, 'TEST Exhausted session 1', v_now - INTERVAL '10 days', v_now - INTERVAL '10 days' + INTERVAL '45 minutes', 'Asia/Kolkata', 'Zoom', 'completed', v_now - INTERVAL '10 days', v_now, v_now),
    (v_exhausted, v_user_id, v_counsellor_id, 'TEST Exhausted session 2', v_now - INTERVAL '2 days', v_now - INTERVAL '2 days' + INTERVAL '45 minutes', 'Asia/Kolkata', 'Zoom', 'completed', v_now - INTERVAL '2 days', v_now, v_now);

  -- F. Administrator manually locked while sessions still remain.
  INSERT INTO service_requests (
    id, request_number, user_id, assigned_counsellor_id,
    request_type, status, title, description,
    timezone, submitted_at, assigned_at, completed_at, created_at, updated_at,
    is_locked, locked_at, locked_by, lock_reason
  ) VALUES (
    v_manual_lock, 'TEST-MANUAL-LOCK', v_user_id, v_counsellor_id,
    'career_counselling', 'completed',
    '[TEST] Engagement status: Manually locked',
    'Test scenario: administrator locked the engagement before remaining approved sessions were used.',
    'Asia/Kolkata', v_now - INTERVAL '12 days', v_now - INTERVAL '11 days', v_now - INTERVAL '1 day', v_now - INTERVAL '12 days', v_now,
    true, v_now - INTERVAL '1 day', NULL, 'Manual test lock with sessions still remaining.'
  );

  INSERT INTO service_entitlements (request_id, sessions_granted, sessions_consumed, status)
  VALUES (v_manual_lock, 5, 2, 'active')
  ON CONFLICT (request_id) DO UPDATE
  SET sessions_granted = EXCLUDED.sessions_granted,
      sessions_consumed = EXCLUDED.sessions_consumed,
      status = EXCLUDED.status,
      updated_at = NOW();

  INSERT INTO sessions (
    request_id, user_id, counsellor_id, title,
    scheduled_start_at, scheduled_end_at, timezone,
    meeting_provider, status, completed_at, created_at, updated_at
  ) VALUES
    (v_manual_lock, v_user_id, v_counsellor_id, 'TEST Manual-lock completed session 1', v_now - INTERVAL '8 days', v_now - INTERVAL '8 days' + INTERVAL '45 minutes', 'Asia/Kolkata', 'Zoom', 'completed', v_now - INTERVAL '8 days', v_now, v_now),
    (v_manual_lock, v_user_id, v_counsellor_id, 'TEST Manual-lock completed session 2', v_now - INTERVAL '3 days', v_now - INTERVAL '3 days' + INTERVAL '45 minutes', 'Asia/Kolkata', 'Zoom', 'completed', v_now - INTERVAL '3 days', v_now, v_now);
END $$;

COMMIT;

-- Expected dashboard classification. These are the six test scenarios created above.
SELECT
  sr.request_number,
  sr.title,
  COALESCE(c.full_name, 'Unassigned') AS counsellor,
  sr.status,
  sr.is_locked,
  COALESCE(se.sessions_granted, 0) AS sessions_granted,
  COALESCE(se.sessions_consumed, 0) AS sessions_consumed,
  GREATEST(COALESCE(se.sessions_granted, 0) - COALESCE(se.sessions_consumed, 0), 0) AS sessions_remaining,
  COALESCE(se.status, 'inactive') AS entitlement_status,
  CASE
    WHEN sr.assigned_counsellor_id IS NULL
      AND sr.is_locked = false
      AND sr.status NOT IN ('cancelled', 'closed', 'completed')
      THEN 'Awaiting assignment'
    WHEN sr.assigned_counsellor_id IS NOT NULL
      AND sr.is_locked = false
      AND sr.status NOT IN ('cancelled', 'closed', 'completed')
      AND COALESCE(se.sessions_granted, 0) <= COALESCE(se.sessions_consumed, 0)
      THEN 'Awaiting entitlement'
    WHEN sr.assigned_counsellor_id IS NOT NULL
      AND sr.is_locked = false
      AND sr.status = 'assigned'
      AND COALESCE(se.sessions_granted, 0) > COALESCE(se.sessions_consumed, 0)
      THEN 'Ready to start'
    WHEN COALESCE(se.status, 'inactive') = 'exhausted'
      THEN 'Exhausted'
    WHEN sr.is_locked = true
      THEN 'Locked manually / completed'
    ELSE 'Active'
  END AS expected_dashboard_state
FROM service_requests sr
LEFT JOIN users c ON c.id = sr.assigned_counsellor_id
LEFT JOIN service_entitlements se ON se.request_id = sr.id
WHERE sr.title LIKE '[TEST] Engagement status:%'
ORDER BY sr.request_number;
