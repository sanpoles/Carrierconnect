-- CareerConnect: remove only the seeded [TEST] engagement status scenarios.
-- This does NOT remove Priya Sharma or any real administrator/counsellor/user account.
-- Step 1: run the PREVIEW section and review the six TEST-* rows.
-- Step 2: when satisfied, run the DELETE section below.

-- PREVIEW ONLY
SELECT
  sr.request_number,
  sr.title,
  sr.status,
  sr.created_at
FROM service_requests sr
WHERE sr.title LIKE '[TEST] Engagement status:%'
   OR sr.request_number LIKE 'TEST-%'
ORDER BY sr.request_number;

-- DELETE ONLY THE TEST ENGAGEMENTS
BEGIN;

CREATE TEMP TABLE cc_test_request_ids ON COMMIT DROP AS
SELECT id
FROM service_requests
WHERE title LIKE '[TEST] Engagement status:%'
   OR request_number LIKE 'TEST-%';

DELETE FROM audit_logs
WHERE request_id IN (SELECT id FROM cc_test_request_ids);

DELETE FROM notifications
WHERE request_id IN (SELECT id FROM cc_test_request_ids);

DELETE FROM request_messages
WHERE request_id IN (SELECT id FROM cc_test_request_ids);

DELETE FROM service_entitlement_adjustments
WHERE request_id IN (SELECT id FROM cc_test_request_ids);

DELETE FROM sessions
WHERE request_id IN (SELECT id FROM cc_test_request_ids);

DELETE FROM service_entitlements
WHERE request_id IN (SELECT id FROM cc_test_request_ids);

DELETE FROM service_requests
WHERE id IN (SELECT id FROM cc_test_request_ids);

COMMIT;

-- VERIFY: should return zero rows.
SELECT request_number, title
FROM service_requests
WHERE title LIKE '[TEST] Engagement status:%'
   OR request_number LIKE 'TEST-%';
