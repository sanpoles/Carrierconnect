BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_country_code VARCHAR(8),
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(20),
  ADD COLUMN IF NOT EXISTS service_contact_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_contact_consent_ip INET,
  ADD COLUMN IF NOT EXISTS service_contact_consent_user_agent TEXT;

ALTER TABLE users
  ADD CONSTRAINT users_phone_country_code_check
    CHECK (phone_country_code IS NULL OR phone_country_code ~ '^\+[1-9][0-9]{0,3}$'),
  ADD CONSTRAINT users_phone_number_check
    CHECK (phone_number IS NULL OR phone_number ~ '^[0-9]{4,14}$'),
  ADD CONSTRAINT users_phone_e164_check
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE user_resume_documents
  ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(30) NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS storage_bucket VARCHAR(255),
  ADD COLUMN IF NOT EXISTS storage_region VARCHAR(100),
  ADD COLUMN IF NOT EXISTS file_extension VARCHAR(12),
  ADD COLUMN IF NOT EXISTS checksum_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaced_by_document_id UUID REFERENCES user_resume_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE user_resume_documents
SET file_extension = LOWER(SUBSTRING(original_file_name FROM '\.([^.]+)$'))
WHERE file_extension IS NULL
  AND LOWER(SUBSTRING(original_file_name FROM '\.([^.]+)$')) IN ('pdf', 'docx');

UPDATE user_resume_documents
SET uploaded_by = user_id
WHERE uploaded_by IS NULL;

ALTER TABLE user_resume_documents
  ADD CONSTRAINT user_resume_documents_storage_provider_check
    CHECK (storage_provider IN ('local', 'object_storage')),
  ADD CONSTRAINT user_resume_documents_file_extension_check
    CHECK (file_extension IS NULL OR file_extension IN ('pdf', 'docx')),
  ADD CONSTRAINT user_resume_documents_checksum_sha256_check
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$');

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS resume_document_id UUID REFERENCES user_resume_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_phone_country_code VARCHAR(8),
  ADD COLUMN IF NOT EXISTS service_phone_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS service_phone_e164 VARCHAR(20),
  ADD COLUMN IF NOT EXISTS service_contact_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_contact_consent_ip INET,
  ADD COLUMN IF NOT EXISTS service_contact_consent_user_agent TEXT;

ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_phone_country_code_check
    CHECK (service_phone_country_code IS NULL OR service_phone_country_code ~ '^\+[1-9][0-9]{0,3}$'),
  ADD CONSTRAINT service_requests_phone_number_check
    CHECK (service_phone_number IS NULL OR service_phone_number ~ '^[0-9]{4,14}$'),
  ADD CONSTRAINT service_requests_phone_e164_check
    CHECK (service_phone_e164 IS NULL OR service_phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

CREATE INDEX IF NOT EXISTS idx_users_phone_e164 ON users(phone_e164);
CREATE INDEX IF NOT EXISTS idx_service_requests_resume_document_id ON service_requests(resume_document_id);
CREATE INDEX IF NOT EXISTS idx_user_resume_documents_active_user ON user_resume_documents(user_id, is_current) WHERE deleted_at IS NULL;

COMMIT;
