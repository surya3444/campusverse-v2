-- Academics › Feedback & Surveys (rule book §13.4; P1 item 18; docs/specs/SURVEYS.md). Owned by
-- shared/surveys. Surveys from templates, open for dates to an audience, answered once per
-- person, scored with weights; actions taken with owners as NAAC evidence.
-- Anonymity: who answered (survey_receipt) is kept apart from the answers (survey_response), and
-- neither carries a time or an ordered id that could link them.

CREATE TABLE survey (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('course', 'faculty', 'facility', 'parent', 'exit', 'alumni', 'employer', 'other')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 160),
  audience text NOT NULL CHECK (audience IN ('staff', 'parents', 'students')),
  anonymous boolean NOT NULL DEFAULT true,
  opens_on date NOT NULL,
  closes_on date NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'open', 'closed')),
  created_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id),
  CHECK (closes_on >= opens_on)
);
CREATE INDEX survey_institution_idx ON survey (org_id, institution_id, state);

CREATE TABLE survey_question (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  survey_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  kind text NOT NULL CHECK (kind IN ('rating', 'choice', 'text')),
  prompt text NOT NULL CHECK (length(btrim(prompt)) BETWEEN 3 AND 300),
  options text[] NOT NULL DEFAULT '{}',
  weight numeric(4, 2) NOT NULL DEFAULT 0 CHECK (weight >= 0 AND weight <= 10),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, survey_id, position),
  FOREIGN KEY (org_id, survey_id) REFERENCES survey (org_id, id),
  CHECK ((kind = 'choice') = (cardinality(options) >= 2)),
  CHECK (kind = 'rating' OR weight = 0)
);

-- Who has answered: one per person, nothing else.
CREATE TABLE survey_receipt (
  org_id uuid NOT NULL REFERENCES organisation (id),
  survey_id uuid NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY (org_id, survey_id, person_id),
  FOREIGN KEY (org_id, survey_id) REFERENCES survey (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id)
);

-- The answers: a random id, the day only, and the person only when the survey is named.
CREATE TABLE survey_response (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL,
  submitted_on date NOT NULL,
  respondent_person_id uuid,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, survey_id) REFERENCES survey (org_id, id),
  FOREIGN KEY (org_id, respondent_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX survey_response_survey_idx ON survey_response (org_id, survey_id);

CREATE TABLE survey_answer (
  org_id uuid NOT NULL REFERENCES organisation (id),
  response_id uuid NOT NULL,
  question_id uuid NOT NULL,
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  choice text CHECK (choice IS NULL OR length(choice) <= 200),
  body text CHECK (body IS NULL OR length(body) <= 2000),
  PRIMARY KEY (org_id, response_id, question_id),
  FOREIGN KEY (org_id, response_id) REFERENCES survey_response (org_id, id),
  FOREIGN KEY (org_id, question_id) REFERENCES survey_question (org_id, id)
);
CREATE INDEX survey_answer_question_idx ON survey_answer (org_id, question_id);

-- What the institution did about it: owners and due dates, the action-taken report.
CREATE TABLE survey_action (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  survey_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 300),
  owner_person_id uuid NOT NULL,
  due_on date NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'done')),
  outcome text CHECK (outcome IS NULL OR length(btrim(outcome)) BETWEEN 3 AND 2000),
  done_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, survey_id) REFERENCES survey (org_id, id),
  FOREIGN KEY (org_id, owner_person_id) REFERENCES person (org_id, id),
  CHECK ((state = 'done') = (done_on IS NOT NULL AND outcome IS NOT NULL))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['survey', 'survey_question', 'survey_receipt', 'survey_response',
    'survey_answer', 'survey_action'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON survey, survey_action TO cv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON survey_question TO cv_app;
GRANT SELECT, INSERT ON survey_receipt, survey_response, survey_answer TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue).
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'survey.form.manage' FROM role r
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'survey.response.submit' FROM role r
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
