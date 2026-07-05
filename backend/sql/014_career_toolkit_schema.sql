BEGIN;

CREATE TABLE IF NOT EXISTS toolkit_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS toolkit_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES toolkit_categories(id) ON DELETE RESTRICT,
  slug VARCHAR(150) NOT NULL UNIQUE,
  title VARCHAR(220) NOT NULL,
  description TEXT NOT NULL,
  resource_type VARCHAR(40) NOT NULL,
  reading_time_minutes INTEGER NOT NULL CHECK (reading_time_minutes BETWEEN 1 AND 120),
  preview_body TEXT NOT NULL,
  content_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  what_you_will_learn JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT toolkit_resources_type_check
    CHECK (resource_type IN ('guide', 'framework', 'checklist', 'worksheet', 'template', 'answer_library')),
  CONSTRAINT toolkit_resources_status_check
    CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT toolkit_resources_content_blocks_check
    CHECK (jsonb_typeof(content_blocks) = 'array'),
  CONSTRAINT toolkit_resources_learn_check
    CHECK (jsonb_typeof(what_you_will_learn) = 'array'),
  CONSTRAINT toolkit_resources_published_at_check
    CHECK ((status = 'published' AND published_at IS NOT NULL) OR status <> 'published')
);

CREATE TABLE IF NOT EXISTS toolkit_resource_saves (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES toolkit_resources(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_toolkit_categories_active_order ON toolkit_categories(is_active, display_order, name);
CREATE INDEX IF NOT EXISTS idx_toolkit_resources_category_status ON toolkit_resources(category_id, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_toolkit_resources_status_type ON toolkit_resources(status, resource_type);
CREATE INDEX IF NOT EXISTS idx_toolkit_resource_saves_resource ON toolkit_resource_saves(resource_id);

DROP TRIGGER IF EXISTS trg_toolkit_categories_updated_at ON toolkit_categories;
CREATE TRIGGER trg_toolkit_categories_updated_at
BEFORE UPDATE ON toolkit_categories
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_toolkit_resources_updated_at ON toolkit_resources;
CREATE TRIGGER trg_toolkit_resources_updated_at
BEFORE UPDATE ON toolkit_resources
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO toolkit_categories (slug, name, description, display_order)
VALUES
  ('find-your-direction', 'Find Your Direction', 'Resources for choosing a credible IT career direction.', 10),
  ('position-your-strengths', 'Position Your Strengths', 'Resources for turning skills, projects, and experience into a clearer career story.', 20),
  ('prepare-for-interviews', 'Prepare for Interviews', 'Resources for practising clearer answers in IT career conversations.', 30)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  is_active = TRUE;

COMMIT;
