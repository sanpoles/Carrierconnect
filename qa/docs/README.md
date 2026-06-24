# CareerConnect Local E2E QA

This QA foundation is local-only and uses the separate PostgreSQL database `careerconnect_qa`. Do not point QA services or tests at the normal development database.

## Primary Setup Method: pgAdmin

The `qa/sql/pgadmin` files are designed for pgAdmin Query Tool.

The older `qa/sql/create_qa_database.sql`, `qa/sql/seed_qa_accounts.sql`, and `qa/sql/reset_qa_data.sql` files are psql-oriented and contain psql meta-commands such as `\connect`, `\i`, `\gexec`, or `\set`. Do not paste those psql scripts into pgAdmin.

## One-Time pgAdmin Database Setup

1. Open pgAdmin.
2. Connect to the default `postgres` database.
3. Open and run:

```text
qa/sql/pgadmin/01_create_qa_database.sql
```

4. Manually switch pgAdmin to the `careerconnect_qa` database.
5. Follow:

```text
qa/sql/pgadmin/02_apply_schema.md
```

Open and execute each listed migration file one at a time against `careerconnect_qa`. Stop and review immediately if any migration fails.

6. Open and run:

```text
qa/sql/pgadmin/03_seed_qa_accounts.sql
```

7. Open and run:

```text
qa/sql/pgadmin/05_verify_qa_setup.sql
```

Confirm the verification output shows `careerconnect_qa`, four QA accounts, the user career profile, counsellor profile and availability, and the expected admin scopes.

## Manual pgAdmin Reset

When you need a clean QA data run:

1. Open pgAdmin.
2. Connect to `careerconnect_qa`.
3. Run:

```text
qa/sql/pgadmin/04_reset_qa_data.sql
```

4. Reseed:

```text
qa/sql/pgadmin/03_seed_qa_accounts.sql
```

5. Verify:

```text
qa/sql/pgadmin/05_verify_qa_setup.sql
```

The PowerShell reset helper intentionally fails safely until `psql` is configured or you choose to use the pgAdmin manual reset path above.

## Start QA Services

Open one PowerShell terminal for the backend:

```powershell
.\scripts\qa\start-backend-qa.ps1
```

Open another PowerShell terminal for the frontend:

```powershell
.\scripts\qa\start-frontend-qa.ps1
```

The frontend runs at `http://localhost:5173`. The backend runs at `http://localhost:4000` and uses `DB_NAME=careerconnect_qa` for that process only.

## Run Smoke Tests

After the QA database has been created, migrated, seeded, and verified manually in pgAdmin:

```powershell
.\scripts\qa\run-smoke-e2e.ps1 -SkipDatabaseCheck
```

The database check currently depends on `psql`. Use `-SkipDatabaseCheck` only after pgAdmin verification has passed.

Open the latest Playwright report:

```powershell
.\scripts\qa\open-playwright-report.ps1
```

## QA Accounts

| Role | Email | Password |
| --- | --- | --- |
| User | `qa.user@careerconnect.test` | `QaUserPassword123` |
| Counsellor | `qa.counsellor@careerconnect.test` | `QaCounsellorPassword123` |
| Operational admin | `qa.operational.admin@careerconnect.test` | `QaOpsAdminPassword123` |
| Platform owner | `qa.platform.owner@careerconnect.test` | `QaOwnerPassword123` |

## Browser Install Note

`@playwright/test` is installed as the only Phase 1 package. If Chromium is not available locally, Playwright may ask for a browser install before tests can run.
