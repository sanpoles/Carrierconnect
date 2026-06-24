-- CareerConnect QA data reset for pgAdmin Query Tool.
-- Run only while connected to the careerconnect_qa database.
-- Deletes only records owned by deterministic QA accounts, QA email markers,
-- and the CAREERCONNECT_QA_E2E marker.

DO $$
BEGIN
  IF current_database() <> 'careerconnect_qa' THEN
    RAISE EXCEPTION 'Refusing to reset %. Use careerconnect_qa only.', current_database();
  END IF;
END $$;

BEGIN;

CREATE TEMP TABLE qa_user_ids ON COMMIT DROP AS
SELECT id
FROM users
WHERE email IN (
    'qa.user@careerconnect.test',
    'qa.counsellor@careerconnect.test',
    'qa.operational.admin@careerconnect.test',
    'qa.platform.owner@careerconnect.test'
  )
  OR email LIKE 'qa.smoke.user.%@careerconnect.test'
  OR email LIKE 'qa+%@careerconnect.test';

CREATE TEMP TABLE qa_request_ids ON COMMIT DROP AS
SELECT id
FROM service_requests
WHERE user_id IN (SELECT id FROM qa_user_ids)
   OR assigned_counsellor_id IN (SELECT id FROM qa_user_ids)
   OR title ILIKE '%CAREERCONNECT_QA_E2E%'
   OR description ILIKE '%CAREERCONNECT_QA_E2E%';

DELETE FROM audit_logs
WHERE actor_user_id IN (SELECT id FROM qa_user_ids)
   OR request_id IN (SELECT id FROM qa_request_ids)
   OR entity_id IN (SELECT id FROM qa_user_ids)
   OR entity_id IN (SELECT id FROM qa_request_ids);

DELETE FROM email_notification_history
WHERE user_id IN (SELECT id FROM qa_user_ids)
   OR request_id IN (SELECT id FROM qa_request_ids)
   OR recipient_email LIKE 'qa.%@careerconnect.test'
   OR recipient_email LIKE 'qa+%@careerconnect.test';

DELETE FROM organization_inquiries
WHERE work_email LIKE 'qa.%@careerconnect.test'
   OR work_email LIKE 'qa+%@careerconnect.test'
   OR current_challenge ILIKE '%CAREERCONNECT_QA_E2E%';

DELETE FROM users
WHERE id IN (SELECT id FROM qa_user_ids);

COMMIT;
