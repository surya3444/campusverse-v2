-- Health Connect, step 1 (rule book §13.9, §12.4 decision 13, P0 item 8): the health vault,
-- sick-room visits and break-glass access. Owned by shared/health.
-- Clinical details are sealed with the health keys (HEALTH_KEYS), apart from every other field.
-- Other systems only ever learn a status ("sent home"), never the reason.

CREATE TABLE health_record (
  org_id uuid NOT NULL REFERENCES organisation (id),
  student_person_id uuid NOT NULL,
  -- Sealed JSON: blood group, allergies, conditions, medicines, notes for responders.
  vault bytea NOT NULL,
  -- Flags for totals only; the details stay sealed.
  has_allergies boolean NOT NULL DEFAULT false,
  has_conditions boolean NOT NULL DEFAULT false,
  blood_group_known boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_account_id uuid,
  PRIMARY KEY (org_id, student_person_id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id)
);

CREATE TABLE health_visit (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  visited_at timestamptz NOT NULL DEFAULT now(),
  -- Sealed JSON: what the student came with, what was done.
  notes bytea NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('back_to_class', 'rested', 'sent_home', 'referred')),
  parent_told boolean NOT NULL DEFAULT false,
  recorded_by_person_id uuid,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, recorded_by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX health_visit_student_idx ON health_visit (org_id, student_person_id, visited_at DESC);
CREATE INDEX health_visit_day_idx ON health_visit (org_id, institution_id, visited_at DESC);

-- Emergency access by someone outside the medical role: a reason, an expiry, the Data Protection
-- Officer told. Append-only.
CREATE TABLE health_break_glass (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  student_person_id uuid NOT NULL,
  opened_by_person_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  opened_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, opened_by_person_id) REFERENCES person (org_id, id),
  CHECK (expires_at > opened_at AND expires_at <= opened_at + interval '2 hours')
);
CREATE INDEX health_break_glass_recent_idx ON health_break_glass (org_id, opened_at DESC);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON health_break_glass
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['health_record', 'health_visit', 'health_break_glass'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON health_record TO cv_app;
GRANT SELECT, INSERT ON health_visit, health_break_glass TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue) and the School nurse role.
-- Named health data is for the medical role only (rule book §10.3): owners and principals get
-- totals and break-glass, never the named records.
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('health.report.read'), ('health.emergency.open')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role (org_id, key, name)
SELECT org_id, 'nurse', 'School nurse' FROM role WHERE key = 'owner'
ON CONFLICT (org_id, key) DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, g.permission, g.relation FROM role r
CROSS JOIN (VALUES ('health.record.read', NULL), ('health.record.update', NULL), ('health.visit.record', NULL),
  ('health.report.read', NULL), ('health.emergency.open', NULL), ('people.student.read', NULL),
  ('people.profile.update_own', 'self'), ('staff.attendance.check_in', 'self'), ('staff.leave.apply', 'self'),
  ('helpdesk.ticket.raise', 'self'), ('people.appraisal.self', 'self'), ('payroll.slip.self', 'self'))
  AS g (permission, relation)
WHERE r.key = 'nurse'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
