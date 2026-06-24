BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admin_scope VARCHAR(30);

-- Establish the existing original administrator as the initial Platform Owner.
-- Any other existing administrator becomes an Operations Admin by default.
WITH first_admin AS (
  SELECT id
  FROM users
  WHERE role = 'admin'
  ORDER BY created_at ASC, id ASC
  LIMIT 1
)
UPDATE users
SET admin_scope = CASE
  WHEN role = 'admin' AND id = (SELECT id FROM first_admin) THEN 'platform_owner'
  WHEN role = 'admin' THEN 'operational'
  ELSE NULL
END
WHERE
  (role = 'admin' AND admin_scope IS DISTINCT FROM CASE
    WHEN id = (SELECT id FROM first_admin) THEN 'platform_owner'
    ELSE 'operational'
  END)
  OR (role <> 'admin' AND admin_scope IS NOT NULL);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_admin_scope_check;

ALTER TABLE users
  ADD CONSTRAINT users_admin_scope_check
  CHECK (
    (role = 'admin' AND admin_scope IN ('operational', 'platform_owner'))
    OR
    (role <> 'admin' AND admin_scope IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_users_admin_scope_active
  ON users (admin_scope, is_active)
  WHERE role = 'admin';

COMMIT;

-- Verification: exactly one existing account should normally be Platform Owner.
SELECT email, role, admin_scope, is_active
FROM users
WHERE role = 'admin'
ORDER BY
  CASE WHEN admin_scope = 'platform_owner' THEN 0 ELSE 1 END,
  created_at ASC;
