-- control: the Campus Verse super admin (staff, passkeys, plans, customers, flags, switches,
-- approvals, support access, admin audit). Global by design and allowlisted like identity: it
-- holds no school data. Admin code reaches a customer only through withTenant(), never a bypass.

CREATE SCHEMA control;
GRANT USAGE ON SCHEMA control TO cv_app;

CREATE TABLE control.staff (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND email LIKE '%_@_%'),
  role text NOT NULL CHECK (role IN ('owner', 'support')),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.passkey (
  credential_id text PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES control.staff (id),
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX passkey_staff_idx ON control.passkey (staff_id);

-- One-time link to register a passkey. Only the token's hash is stored.
CREATE TABLE control.enrolment (
  token_hash bytea PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES control.staff (id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- A WebAuthn challenge, used once within five minutes.
CREATE TABLE control.challenge (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  staff_id uuid NOT NULL REFERENCES control.staff (id),
  purpose text NOT NULL CHECK (purpose IN ('register', 'sign_in')),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE control.session (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  staff_id uuid NOT NULL REFERENCES control.staff (id),
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz
);

CREATE TABLE control.plan (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  student_limit integer CHECK (student_limit > 0),
  -- Per student per year, in paise.
  price_paise bigint NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  features text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per organisation: the customer record. status decides access for every school request.
CREATE TABLE control.customer (
  org_id uuid PRIMARY KEY REFERENCES organisation (id),
  name text NOT NULL,
  plan_code text NOT NULL REFERENCES control.plan (code),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.flag (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,47}$'),
  description text NOT NULL,
  default_on boolean NOT NULL
);

CREATE TABLE control.flag_override (
  key text NOT NULL REFERENCES control.flag (key),
  org_id uuid NOT NULL REFERENCES control.customer (org_id),
  enabled boolean NOT NULL,
  PRIMARY KEY (key, org_id)
);

-- Emergency switches. A row means the switch is on; org_id NULL means every customer.
CREATE TABLE control.switch (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  key text NOT NULL CHECK (key IN ('messaging_off', 'payments_off', 'writes_off')),
  org_id uuid REFERENCES control.customer (org_id),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  set_by uuid NOT NULL REFERENCES control.staff (id),
  set_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX switch_one_per_scope
  ON control.switch (key, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Maker-checker for actions that need a second person.
CREATE TABLE control.approval (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  kind text NOT NULL CHECK (kind IN ('customer_status', 'support_access')),
  org_id uuid NOT NULL REFERENCES control.customer (org_id),
  payload jsonb NOT NULL DEFAULT '{}',
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  requested_by uuid NOT NULL REFERENCES control.staff (id),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'approved', 'rejected')),
  decided_by uuid REFERENCES control.staff (id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK ((state = 'requested') = (decided_by IS NULL))
);

CREATE TABLE control.support_grant (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  approval_id uuid NOT NULL UNIQUE REFERENCES control.approval (id),
  staff_id uuid NOT NULL REFERENCES control.staff (id),
  org_id uuid NOT NULL REFERENCES control.customer (org_id),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  CHECK (expires_at > starts_at AND expires_at <= starts_at + interval '4 hours')
);

CREATE TABLE control.admin_audit (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  staff_id uuid REFERENCES control.staff (id),
  action text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  org_id uuid,
  reason text,
  -- Ids and codes only.
  detail jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_org_idx ON control.admin_audit (org_id, at);
CREATE INDEX admin_audit_staff_idx ON control.admin_audit (staff_id, at);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON control.admin_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON control.admin_audit
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA control TO cv_app;
GRANT DELETE ON control.flag_override, control.switch TO cv_app;
REVOKE UPDATE ON control.admin_audit FROM cv_app;

INSERT INTO control.plan (code, name, student_limit, price_paise, features) VALUES
  ('pilot', 'Pilot', 1000, 0, '{online_payments}'),
  ('standard', 'Standard', NULL, 60000, '{online_payments,verse_ai}');

INSERT INTO control.flag (key, description, default_on) VALUES
  ('online_payments', 'Parents can pay fees online through the app', true),
  ('verse_ai', 'Verse AI answers in the school app', false);

-- Every existing organisation becomes a customer on the pilot plan (the migrator may read all).
INSERT INTO control.customer (org_id, name, plan_code, status)
SELECT id, name, 'pilot', status FROM organisation;
