param(
  [string]$DatabaseName = "careerconnect_qa"
)

$ErrorActionPreference = "Stop"

if ($DatabaseName -ne "careerconnect_qa") {
  throw "Refusing to reset DB_NAME=$DatabaseName. Expected careerconnect_qa."
}

throw @"
Automatic QA reset is unavailable because this local workflow uses pgAdmin Query Tool instead of psql.

No database changes were attempted.

To reset QA data safely:
1. Open pgAdmin.
2. Connect to the careerconnect_qa database.
3. Run qa/sql/pgadmin/04_reset_qa_data.sql.
4. Run qa/sql/pgadmin/03_seed_qa_accounts.sql if you need the deterministic QA accounts restored.
"@
