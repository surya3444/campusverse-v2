-- Milestone 18 foundations (decision 0020): owner-defined fields, role changes that need a
-- second owner, and the owner role.

------------------------------------------------------------------------------------------
-- Owner-defined fields (platform/fields)
------------------------------------------------------------------------------------------
CREATE TABLE custom_field (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  entity text NOT NULL
    CHECK (entity IN ('organisation', 'campus', 'institution', 'admission', 'staff', 'student', 'guardian')),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text NOT NULL CHECK (btrim(label) <> '' AND length(label) <= 80),
  help text CHECK (length(help) <= 200),
  type text NOT NULL CHECK (type IN (
    'text', 'long_text', 'number', 'date', 'yes_no', 'choice', 'multi_choice', 'phone', 'email', 'file')),
  options jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(options) = 'array'),
  required boolean NOT NULL DEFAULT false,
  section text CHECK (length(section) <= 60),
  position integer NOT NULL DEFAULT 0,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, entity, key),
  CHECK (type IN ('choice', 'multi_choice') OR options = '[]'::jsonb)
);

-- One value per record and field. record_id is the organisation, campus, institution, person or
-- application id; it has no foreign key because the target table depends on the entity.
CREATE TABLE custom_field_value (
  org_id uuid NOT NULL REFERENCES organisation (id),
  field_id uuid NOT NULL,
  record_id uuid NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, field_id, record_id),
  FOREIGN KEY (org_id, field_id) REFERENCES custom_field (org_id, id)
);
CREATE INDEX custom_field_value_record_idx ON custom_field_value (org_id, record_id);

------------------------------------------------------------------------------------------
-- Sensitive grants wait for a second owner (platform/access)
------------------------------------------------------------------------------------------
CREATE TABLE role_grant_request (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  role_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+$'),
  requested_by_person_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decision text CHECK (decision IN ('approved', 'rejected', 'withdrawn', 'confirmed_alone')),
  decided_by_person_id uuid,
  decided_at timestamptz,
  reason text CHECK (length(reason) <= 300),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, role_id) REFERENCES role (org_id, id),
  FOREIGN KEY (org_id, requested_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, decided_by_person_id) REFERENCES person (org_id, id),
  CHECK ((decision IS NULL) = (decided_at IS NULL) AND (decision IS NULL) = (decided_by_person_id IS NULL)),
  -- Four eyes, enforced here and not only in code: an approver is never the requester.
  CHECK (decision IS DISTINCT FROM 'approved' OR decided_by_person_id <> requested_by_person_id),
  CHECK (decision IS DISTINCT FROM 'rejected' OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX role_grant_request_open_idx
  ON role_grant_request (org_id, role_id, permission) WHERE decision IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['custom_field', 'custom_field_value', 'role_grant_request'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON custom_field, custom_field_value, role_grant_request TO cv_app;
-- Roles are now edited on screen: names change and grants are removed.
GRANT UPDATE ON role TO cv_app;
GRANT DELETE ON role_grant TO cv_app;

------------------------------------------------------------------------------------------
-- The owner role for existing organisations: everything a school administrator holds, plus
-- roles, fields and activity. Holders of school_admin across the organisation become owners.
------------------------------------------------------------------------------------------
INSERT INTO role (org_id, key, name)
SELECT id, 'owner', 'Owner' FROM organisation
ON CONFLICT (org_id, key) DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT o.org_id, o.id, g.permission
FROM role o
JOIN role a ON a.org_id = o.org_id AND a.key = 'school_admin'
JOIN role_grant g ON g.org_id = a.org_id AND g.role_id = a.id AND g.relation IS NULL
WHERE o.key = 'owner'
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission
FROM role r
CROSS JOIN (VALUES ('platform.role.read'), ('platform.role.manage'), ('platform.role.approve'),
  ('platform.role.assign'), ('platform.fields.manage'), ('platform.activity.read')) AS p (permission)
WHERE r.key = 'owner'
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission
FROM role r
CROSS JOIN (VALUES ('platform.role.read'), ('platform.activity.read')) AS p (permission)
WHERE r.key IN ('school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_assignment (org_id, person_id, role_id, scope_type, scope_id)
SELECT DISTINCT a.org_id, a.person_id, o.id, 'organisation', a.org_id
FROM role_assignment a
JOIN role s ON s.org_id = a.org_id AND s.id = a.role_id AND s.key = 'school_admin'
JOIN role o ON o.org_id = a.org_id AND o.key = 'owner'
WHERE a.scope_type = 'organisation' AND a.valid_during @> app_today()
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
