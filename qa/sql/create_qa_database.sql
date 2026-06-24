-- CareerConnect QA database bootstrap.
-- Run from the repository root with:
-- psql -U postgres -h localhost -p 5432 -d postgres -f qa/sql/create_qa_database.sql
--
-- This script creates careerconnect_qa if it does not exist, connects to it,
-- and applies the current schema migrations. It is intentionally never run
-- automatically by the E2E scripts.

SELECT 'CREATE DATABASE careerconnect_qa'
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_database
  WHERE datname = 'careerconnect_qa'
)\gexec

\connect careerconnect_qa

\i backend/sql/001_careerconnect_schema.sql
\i backend/sql/002_password_reset_and_auth_version.sql
\i backend/sql/003_service_entitlements_and_request_locking.sql
\i backend/sql/004_engagement_entitlements_and_locking.sql
\i backend/sql/008_organization_inquiries.sql
\i backend/sql/009_identity_availability_and_career_profile.sql
\i backend/sql/010_platform_owner_admin_scope.sql
