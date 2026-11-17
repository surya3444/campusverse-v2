-- Security incidents and personal-data breaches (super admin). Clocks run from discovery:
-- CERT-In report within 6 hours; Data Protection Board and affected schools within 72 hours.
-- Each step records when and by whom; every change is also in control.admin_audit.

CREATE TABLE control.incident (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  title text NOT NULL CHECK (length(btrim(title)) >= 3),
  details text NOT NULL CHECK (length(btrim(details)) >= 10),
  discovered_at timestamptz NOT NULL,
  personal_data boolean NOT NULL,
  opened_by uuid NOT NULL REFERENCES control.staff (id),
  certin_reported_at timestamptz,
  certin_reported_by uuid REFERENCES control.staff (id),
  board_notified_at timestamptz,
  board_notified_by uuid REFERENCES control.staff (id),
  schools_notified_at timestamptz,
  schools_notified_by uuid REFERENCES control.staff (id),
  closed_at timestamptz,
  closed_by uuid REFERENCES control.staff (id),
  closing_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (discovered_at <= created_at + interval '5 minutes'),
  CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CHECK (closed_at IS NULL OR closing_note IS NOT NULL)
);

CREATE TABLE control.incident_customer (
  incident_id uuid NOT NULL REFERENCES control.incident (id),
  org_id uuid NOT NULL REFERENCES control.customer (org_id),
  PRIMARY KEY (incident_id, org_id)
);

GRANT SELECT, INSERT, UPDATE ON control.incident, control.incident_customer TO cv_app;
