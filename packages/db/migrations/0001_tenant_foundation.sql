-- Tenant root and campus tree: organisation, legal entity, campus, institution.
-- created_by columns arrive with person in Milestone 4.

-- The current tenant, set per transaction by withTenant(). NULL when unset, so policies fail closed.
CREATE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

CREATE TABLE organisation (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legal_entity (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  gstin text CHECK (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);

CREATE TABLE campus (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);

CREATE TABLE institution (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  campus_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('school', 'college', 'university')),
  authority_code text NOT NULL CHECK (authority_code ~ '^[A-Z0-9_]{2,32}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'setup', 'pilot', 'live', 'read_only', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, campus_id) REFERENCES campus (org_id, id),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES legal_entity (org_id, id)
);

-- Foreign key lookups; tables are empty, so plain CREATE INDEX is safe here.
CREATE INDEX institution_campus_idx ON institution (org_id, campus_id);
CREATE INDEX institution_legal_entity_idx ON institution (org_id, legal_entity_id);

ALTER TABLE organisation ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organisation
  USING (id = app_current_org()) WITH CHECK (id = app_current_org());

ALTER TABLE legal_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_entity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_entity
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE campus ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON campus
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE institution ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON institution
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

-- No DELETE: these records close by status, never disappear.
GRANT USAGE ON SCHEMA public TO cv_app;
GRANT SELECT, INSERT, UPDATE ON organisation, legal_entity, campus, institution TO cv_app;
