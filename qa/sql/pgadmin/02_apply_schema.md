# Apply CareerConnect Schema in pgAdmin

After `qa/sql/pgadmin/01_create_qa_database.sql` succeeds, manually switch pgAdmin to the `careerconnect_qa` database.

Open and execute each migration file one at a time against `careerconnect_qa`, in this exact order:

1. `backend/sql/001_careerconnect_schema.sql`
2. `backend/sql/002_password_reset_and_auth_version.sql`
3. `backend/sql/003_service_entitlements_and_request_locking.sql`
4. `backend/sql/004_engagement_entitlements_and_locking.sql`
5. `backend/sql/008_organization_inquiries.sql`
6. `backend/sql/009_identity_availability_and_career_profile.sql`
7. `backend/sql/010_platform_owner_admin_scope.sql`

Stop immediately and review the error if any migration fails. Do not continue to later migrations, seed data, or E2E tests until the failure is understood and corrected.
