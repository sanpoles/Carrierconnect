# E2E Test Matrix

## Local Setup Path

Phase 1 uses pgAdmin Query Tool as the primary local database setup path. Run the files in `qa/sql/pgadmin` manually, verify the QA setup, then run smoke tests. The psql-oriented SQL files under `qa/sql` should not be pasted into pgAdmin.

## Phase 1 Smoke Coverage

| Area | Scenario | Account | Status |
| --- | --- | --- | --- |
| Public | Public home page loads | Anonymous | Implemented |
| Auth | Protected user route redirects to login when unauthenticated | Anonymous | Implemented |
| Auth | User registration, login, logout | QA smoke user | Implemented |
| Admin access | Operational admin sees the admin dashboard heading but cannot access Platform Owner-only user management | Operational admin | Implemented |
| Admin access | Platform Owner sees the admin dashboard heading and can open user management | Platform owner | Implemented |

## Phase 2 Candidates

| Area | Scenario |
| --- | --- |
| Career profile | User completes/updates career profile |
| Requests | User submits career counselling or mock interview request |
| Admin operations | Admin assigns counsellor and approves sessions |
| Counsellor operations | Counsellor sees assigned engagement |
| Booking | User books an available slot |
| Realtime | Message/notification visibility without refresh |
| Internal notes | Admin/counsellor internal note flow |
| Entitlements | Exhaustion, lock, reopen, and close workflows |

Phase 2 must not be added until the QA data lifecycle for those workflows is approved.
