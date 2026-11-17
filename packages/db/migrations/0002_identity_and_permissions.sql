-- Global login identity (schema identity) and tenant people, roles and duties (schema public).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Calendar day in IST. Valid-date ranges are compared against this, never the server's UTC date.
CREATE FUNCTION app_today() RETURNS date
  LANGUAGE sql STABLE
  AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

------------------------------------------------------------------------------------------
-- identity: global, before any tenant is chosen. Holds login facts only, never tenant data.
------------------------------------------------------------------------------------------
CREATE SCHEMA identity;

CREATE TABLE identity.account (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.login_identifier (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  account_id uuid NOT NULL REFERENCES identity.account (id),
  kind text NOT NULL CHECK (kind IN ('phone', 'email', 'google', 'microsoft')),
  value text NOT NULL CHECK (
    (kind = 'phone' AND value ~ '^\+91[6-9][0-9]{9}$')
    OR (kind = 'email' AND value = lower(value) AND value ~ '^[^@\s]+@[^@\s]+$')
    OR (kind IN ('google', 'microsoft') AND value <> '')
  ),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);
CREATE INDEX login_identifier_account_idx ON identity.login_identifier (account_id);

-- One login can act as several people: across organisations, or a shared family phone.
CREATE TABLE identity.account_person_link (
  account_id uuid NOT NULL REFERENCES identity.account (id),
  org_id uuid NOT NULL,
  person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, org_id, person_id)
);

CREATE TABLE identity.trusted_device (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  account_id uuid NOT NULL REFERENCES identity.account (id),
  label text NOT NULL CHECK (btrim(label) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX trusted_device_account_idx ON identity.trusted_device (account_id);

-- Tokens are stored only as SHA-256 hashes. Rotation chains rows in one family via replaced_by.
CREATE TABLE identity.session (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  family_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES identity.account (id),
  device_id uuid NOT NULL REFERENCES identity.trusted_device (id),
  access_hash bytea NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_hash bytea NOT NULL UNIQUE,
  refresh_expires_at timestamptz NOT NULL,
  replaced_by uuid REFERENCES identity.session (id),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX session_family_idx ON identity.session (family_id);
CREATE INDEX session_device_idx ON identity.session (device_id);
CREATE INDEX session_account_idx ON identity.session (account_id);

GRANT USAGE ON SCHEMA identity TO cv_app;
-- No DELETE: sessions and devices are revoked, not removed, so the trail survives.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA identity TO cv_app;

------------------------------------------------------------------------------------------
-- public: tenant tables. RLS on every one.
------------------------------------------------------------------------------------------

-- Bumped on any change to roles, grants, assignments, duties or guardian links, so cached
-- permission snapshots (keyed by this number) go stale at once.
ALTER TABLE organisation ADD COLUMN permission_version integer NOT NULL DEFAULT 1;

CREATE TABLE person (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  legal_name text NOT NULL CHECK (btrim(legal_name) <> ''),
  date_of_birth date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);

ALTER TABLE identity.account_person_link
  ADD FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id);

CREATE TABLE guardian_link (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  guardian_person_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  relationship text NOT NULL
    CHECK (relationship IN ('mother', 'father', 'guardian', 'grandparent', 'sibling', 'other')),
  is_primary_contact boolean NOT NULL DEFAULT false,
  can_login boolean NOT NULL DEFAULT true,
  is_fee_payer boolean NOT NULL DEFAULT false,
  can_pickup boolean NOT NULL DEFAULT false,
  academic_messages boolean NOT NULL DEFAULT true,
  fee_messages boolean NOT NULL DEFAULT false,
  location_access boolean NOT NULL DEFAULT false,
  -- A restricted guardian is blocked everywhere at once: access, messages, pickup.
  restricted_at timestamptz,
  restriction_reason text,
  valid_during daterange NOT NULL DEFAULT daterange(app_today(), NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, guardian_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  CHECK (guardian_person_id <> student_person_id),
  CHECK ((restricted_at IS NULL) = (restriction_reason IS NULL)),
  EXCLUDE USING gist (
    org_id WITH =, guardian_person_id WITH =, student_person_id WITH =, valid_during WITH &&
  )
);
CREATE INDEX guardian_link_student_idx ON guardian_link (org_id, student_person_id);

-- Each school edits its own copy of the role templates.
CREATE TABLE role (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, key)
);

-- relation: the actor must be the subject person ('self') or an unrestricted guardian of them.
CREATE TABLE role_grant (
  org_id uuid NOT NULL REFERENCES organisation (id),
  role_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+$'),
  relation text CHECK (relation IN ('self', 'guardian')),
  guardian_flag text
    CHECK (guardian_flag IN ('is_fee_payer', 'can_pickup', 'academic_messages', 'fee_messages', 'location_access')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, role_id, permission),
  FOREIGN KEY (org_id, role_id) REFERENCES role (org_id, id),
  CHECK (guardian_flag IS NULL OR relation = 'guardian')
);

-- scope_id is a campus or institution id (or org_id for organisation scope). It has no FK
-- because the target table varies; a wrong id only ever fails to match, it never widens access.
CREATE TABLE role_assignment (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  role_id uuid NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('organisation', 'campus', 'institution')),
  scope_id uuid NOT NULL,
  valid_during daterange NOT NULL DEFAULT daterange(app_today(), NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, role_id) REFERENCES role (org_id, id),
  CHECK (scope_type <> 'organisation' OR scope_id = org_id),
  EXCLUDE USING gist (
    org_id WITH =, person_id WITH =, role_id WITH =, scope_id WITH =, valid_during WITH &&
  )
);
CREATE INDEX role_assignment_person_idx ON role_assignment (org_id, person_id);

-- Temporary duties (exam superintendent, bus duty). Always end-dated, so the access expires.
CREATE TABLE staff_duty (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  duty text NOT NULL CHECK (duty ~ '^[a-z][a-z0-9_]{1,40}$'),
  role_id uuid NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('organisation', 'campus', 'institution')),
  scope_id uuid NOT NULL,
  valid_during daterange NOT NULL CHECK (NOT upper_inf(valid_during) AND NOT lower_inf(valid_during)),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, role_id) REFERENCES role (org_id, id),
  CHECK (scope_type <> 'organisation' OR scope_id = org_id)
);
CREATE INDEX staff_duty_person_idx ON staff_duty (org_id, person_id);

CREATE FUNCTION bump_permission_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  -- Writes only succeed under tenant context, so the changed org is the current one.
  UPDATE organisation SET permission_version = permission_version + 1 WHERE id = app_current_org();
  RETURN NULL;
END $$;

CREATE TRIGGER bump_permission_version AFTER INSERT OR UPDATE OR DELETE ON role_grant
  FOR EACH STATEMENT EXECUTE FUNCTION bump_permission_version();
CREATE TRIGGER bump_permission_version AFTER INSERT OR UPDATE OR DELETE ON role_assignment
  FOR EACH STATEMENT EXECUTE FUNCTION bump_permission_version();
CREATE TRIGGER bump_permission_version AFTER INSERT OR UPDATE OR DELETE ON staff_duty
  FOR EACH STATEMENT EXECUTE FUNCTION bump_permission_version();
CREATE TRIGGER bump_permission_version AFTER INSERT OR UPDATE OR DELETE ON guardian_link
  FOR EACH STATEMENT EXECUTE FUNCTION bump_permission_version();

ALTER TABLE person ENABLE ROW LEVEL SECURITY;
ALTER TABLE person FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON person
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE guardian_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_link FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guardian_link
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE role ENABLE ROW LEVEL SECURITY;
ALTER TABLE role FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE role_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_grant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_grant
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_assignment
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE staff_duty ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_duty FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_duty
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

-- Revoking access ends valid_during; rows are never deleted. Grants can be removed from a role.
GRANT SELECT, INSERT, UPDATE ON person, guardian_link, role, role_assignment, staff_duty TO cv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_grant TO cv_app;
