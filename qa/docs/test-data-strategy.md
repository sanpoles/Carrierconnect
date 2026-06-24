# QA Test Data Strategy

## Database Boundary

All automated E2E work must use `careerconnect_qa`. Tests must never run against the normal development database or any database containing real customer data.

## Data Markers

QA data uses the email domain `careerconnect.test` and the marker `CAREERCONNECT_QA_E2E` in descriptive fields where practical. Seeded role accounts use fixed emails so tests can log in repeatably.

## Repeatability

The reset SQL deletes only QA-owned records and QA marker data. It guards against accidental execution outside `careerconnect_qa`.

The registration smoke test uses:

```text
qa.smoke.user.${QA_RUN_ID}@careerconnect.test
```

Use the default `QA_RUN_ID=local` for local smoke runs, or set a different run ID when you want parallel/manual isolation. Reset QA data before repeating the same `QA_RUN_ID`.

## Setup Pattern

Phase 1 uses manual SQL setup:

1. Create/apply schema to `careerconnect_qa`.
2. Seed deterministic QA role accounts.
3. Start backend with `DB_NAME=careerconnect_qa`.
4. Start frontend.
5. Run smoke tests.

## Cleanup Pattern

Cleanup is explicit and reviewable:

```powershell
.\scripts\qa\reset-qa-data.ps1
psql -U postgres -h localhost -p 5432 -d careerconnect_qa -f qa/sql/seed_qa_accounts.sql
```

No E2E script runs schema creation, seed SQL, or reset SQL automatically.
