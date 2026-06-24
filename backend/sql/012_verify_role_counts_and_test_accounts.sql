-- CareerConnect user and counsellor count verification
-- Run this first. It does not change data.

-- 1) Exact account count by role and activation state.
SELECT
  role,
  COALESCE(admin_scope, '—') AS admin_scope,
  is_active,
  COUNT(*) AS account_count
FROM users
GROUP BY role, admin_scope, is_active
ORDER BY role, admin_scope, is_active DESC;

-- 2) The six records currently counted by the Admin Dashboard "Career users" card.
-- The dashboard intentionally counts ONLY role = 'user' and excludes all admins and counsellors.
SELECT
  id,
  full_name,
  email,
  role,
  admin_scope,
  is_active,
  created_at
FROM users
WHERE role = 'user'
ORDER BY created_at ASC;

-- 3) Test-account review only. Priya is intentionally excluded.
-- Review the result before deleting anything.
SELECT
  id,
  full_name,
  email,
  role,
  is_active,
  created_at
FROM users
WHERE (
    full_name ILIKE '%test%'
    OR email ILIKE '%test%'
    OR email ILIKE '%@careerconnect.test'
  )
  AND email <> 'priya.sharma.e2e@careerconnect.test'
ORDER BY created_at ASC;
