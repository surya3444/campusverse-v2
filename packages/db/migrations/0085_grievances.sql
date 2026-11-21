-- Quality & Compliance › Grievances & Committees (rule book §13.11, §15; P1 item 33). Owned by
-- shared/grievances. Statutory committees with members and meetings, and cases with an anonymous
-- option, timelines, outcomes and appeals. A case is seen only by its committee's members and by
-- whoever raised it; leaders see counts only (POSH confidentiality).

CREATE TABLE grievance_committee (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('internal_complaints', 'anti_ragging', 'sc_st_cell',
    'grievance_redressal', 'other')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 120),
  decide_days integer NOT NULL CHECK (decide_days BETWEEN 1 AND 365),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);

-- Members are staff of the institution, or named outside members (the POSH external member).
CREATE TABLE grievance_member (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  committee_id uuid NOT NULL,
  person_id uuid,
  outside_name text CHECK (outside_name IS NULL OR length(btrim(outside_name)) BETWEEN 2 AND 120),
  role text NOT NULL CHECK (role IN ('chair', 'member', 'outside_member')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, committee_id) REFERENCES grievance_committee (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  CHECK ((person_id IS NULL) <> (outside_name IS NULL))
);
CREATE UNIQUE INDEX grievance_member_person_uq ON grievance_member (org_id, committee_id, person_id)
  WHERE person_id IS NOT NULL;

CREATE TABLE grievance_meeting (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  committee_id uuid NOT NULL,
  held_on date NOT NULL,
  minutes text NOT NULL CHECK (length(btrim(minutes)) BETWEEN 3 AND 8000),
  recorded_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, committee_id) REFERENCES grievance_committee (org_id, id),
  FOREIGN KEY (org_id, recorded_by_person_id) REFERENCES person (org_id, id)
);

CREATE TABLE grievance_case (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  committee_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  raised_by_person_id uuid NOT NULL,
  -- The committee sees "Anonymous"; the raiser still follows their own case.
  anonymous boolean NOT NULL DEFAULT false,
  about_student_id uuid,
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 160),
  details text NOT NULL CHECK (length(btrim(details)) BETWEEN 10 AND 8000),
  state text NOT NULL DEFAULT 'received' CHECK (state IN ('received', 'inquiry', 'decided', 'appealed', 'closed')),
  received_on date NOT NULL,
  due_on date NOT NULL,
  outcome text CHECK (outcome IS NULL OR length(btrim(outcome)) BETWEEN 3 AND 4000),
  decided_on date,
  appeal text CHECK (appeal IS NULL OR length(btrim(appeal)) BETWEEN 10 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, committee_id, number),
  FOREIGN KEY (org_id, committee_id) REFERENCES grievance_committee (org_id, id),
  FOREIGN KEY (org_id, raised_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, about_student_id) REFERENCES person (org_id, id),
  CHECK (due_on >= received_on),
  CHECK ((state IN ('decided', 'appealed', 'closed')) = (outcome IS NOT NULL AND decided_on IS NOT NULL))
);
CREATE INDEX grievance_case_raiser_idx ON grievance_case (org_id, raised_by_person_id);

-- The committee's record of the case: hearings, evidence received, interim steps. Append-only.
CREATE TABLE grievance_note (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  case_id uuid NOT NULL,
  author_person_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 2 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, case_id) REFERENCES grievance_case (org_id, id),
  FOREIGN KEY (org_id, author_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX grievance_note_case_idx ON grievance_note (org_id, case_id, created_at);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON grievance_note
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['grievance_committee', 'grievance_member', 'grievance_meeting',
    'grievance_case', 'grievance_note'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON grievance_committee, grievance_member, grievance_meeting, grievance_case TO cv_app;
GRANT SELECT, INSERT ON grievance_note TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue). Handling a case is by
-- committee membership, checked in the module, not by a role.
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'grievance.committee.manage' FROM role r
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'grievance.case.raise', CASE WHEN r.key = 'parent' THEN 'guardian' ELSE NULL END
FROM role r
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
