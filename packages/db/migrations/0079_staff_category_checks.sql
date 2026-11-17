-- Staff of every kind (people/records): teachers, office staff and support staff (drivers, bus
-- attendants, security, wardens, housekeeping), and the safety checks of people who work with
-- children (police verification; for drivers also the driving licence and medical fitness).

ALTER TABLE staff_profile
  ADD COLUMN category text CHECK (category IN ('teaching', 'administrative', 'support'));

-- Existing staff take the category of the role they hold today.
UPDATE staff_profile s SET category = c.category
FROM (
  SELECT ra.org_id, ra.person_id,
    CASE
      WHEN bool_or(r.key = 'teacher') THEN 'teaching'
      WHEN bool_or(r.key IN ('office', 'principal', 'school_admin', 'owner')) THEN 'administrative'
      ELSE 'support'
    END AS category
  FROM role_assignment ra JOIN role r ON r.org_id = ra.org_id AND r.id = ra.role_id
  WHERE ra.valid_during @> current_date
  GROUP BY ra.org_id, ra.person_id
) c
WHERE s.org_id = c.org_id AND s.person_id = c.person_id;

-- Append-only: a renewed licence is a new row; the latest row of a kind counts.
CREATE TABLE staff_check (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('police_verification', 'driving_licence', 'medical_fitness', 'psv_badge')),
  reference text CHECK (reference IS NULL OR (btrim(reference) <> '' AND length(reference) <= 60)),
  checked_on date NOT NULL,
  valid_until date CHECK (valid_until IS NULL OR valid_until >= checked_on),
  note text CHECK (note IS NULL OR length(note) <= 300),
  recorded_by_person_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES staff_profile (org_id, person_id),
  FOREIGN KEY (org_id, recorded_by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX staff_check_person_idx ON staff_check (org_id, person_id, kind, checked_on DESC);

ALTER TABLE staff_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_check FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_check USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());

GRANT SELECT, INSERT ON staff_check TO cv_app;
CREATE TRIGGER append_only BEFORE UPDATE ON staff_check
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
