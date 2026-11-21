-- Health Connect, step 2 (rule book §13.9 Medical Visits & Stock, Emergency; §16.5 steps 3–6).
-- Owned by shared/health. Medicines are kept by batch so the earliest expiry is used first;
-- every movement is logged and never changed. An SOS from any staff member opens an incident,
-- tells the principal, the nurse and the family, and lists the partner hospitals to call.

CREATE TABLE health_medicine (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 30),
  reorder_level integer NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);
CREATE UNIQUE INDEX health_medicine_name_uq ON health_medicine (org_id, institution_id, lower(btrim(name)));

CREATE TABLE health_medicine_batch (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  medicine_id uuid NOT NULL,
  expires_on date NOT NULL,
  received integer NOT NULL CHECK (received > 0),
  remaining integer NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, medicine_id) REFERENCES health_medicine (org_id, id),
  CHECK (remaining BETWEEN 0 AND received)
);
CREATE INDEX health_medicine_batch_fefo_idx ON health_medicine_batch (org_id, medicine_id, expires_on) WHERE remaining > 0;

-- Every receipt, dose given and discard. Append-only. A dose may name the sick-room visit; the
-- student is reached only through that sealed visit.
CREATE TABLE health_medicine_move (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  medicine_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('receive', 'dispense', 'discard')),
  quantity integer NOT NULL CHECK (quantity > 0),
  visit_id uuid,
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 300),
  by_person_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, medicine_id) REFERENCES health_medicine (org_id, id),
  FOREIGN KEY (org_id, batch_id) REFERENCES health_medicine_batch (org_id, id),
  FOREIGN KEY (org_id, visit_id) REFERENCES health_visit (org_id, id),
  FOREIGN KEY (org_id, by_person_id) REFERENCES person (org_id, id),
  CHECK (kind <> 'discard' OR reason IS NOT NULL)
);
CREATE INDEX health_medicine_move_idx ON health_medicine_move (org_id, medicine_id, at DESC);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON health_medicine_move
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Hospitals, clinics and ambulances to call, in the order the school wants them tried.
CREATE TABLE health_partner (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  kind text NOT NULL CHECK (kind IN ('hospital', 'clinic', 'ambulance', 'pharmacy')),
  phone text NOT NULL CHECK (phone ~ '^[0-9+ -]{6,20}$'),
  address text CHECK (address IS NULL OR length(address) <= 300),
  sort integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);

-- An emergency. The report is sealed with the health keys; totals read the kind and outcome only.
CREATE TABLE health_incident (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  student_person_id uuid,
  kind text NOT NULL CHECK (kind IN ('medical', 'injury', 'fire', 'missing_child', 'other')),
  location text NOT NULL CHECK (length(btrim(location)) BETWEEN 2 AND 200),
  raised_by_person_id uuid NOT NULL,
  raised_at timestamptz NOT NULL DEFAULT now(),
  break_glass_id uuid,
  closed_at timestamptz,
  closed_by_person_id uuid,
  outcome text CHECK (outcome IN ('resolved_on_site', 'sent_home', 'hospital', 'false_alarm')),
  report bytea,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, raised_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, closed_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, break_glass_id) REFERENCES health_break_glass (org_id, id),
  CHECK ((closed_at IS NULL) = (outcome IS NULL) AND (closed_at IS NULL) = (closed_by_person_id IS NULL))
);
CREATE INDEX health_incident_open_idx ON health_incident (org_id, institution_id, raised_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['health_medicine', 'health_medicine_batch', 'health_medicine_move',
    'health_partner', 'health_incident'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON health_medicine, health_medicine_batch, health_partner, health_incident TO cv_app;
GRANT SELECT, INSERT ON health_medicine_move TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue).
-- health.stock.manage: the medical role. health.emergency.manage: leaders and the nurse close
-- incidents and keep the partner list. health.emergency.raise: every staff member, for SOS.
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'health.stock.manage' FROM role r WHERE r.key IN ('owner', 'nurse')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'health.emergency.manage' FROM role r
WHERE r.key IN ('owner', 'school_admin', 'principal', 'nurse')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'health.emergency.raise', 'self' FROM role r
WHERE r.key <> 'parent'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
