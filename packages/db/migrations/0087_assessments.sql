-- Academics › Assessments (rule book §13.2: Question Bank, Quizzes & Tests; P1 item 16;
-- docs/specs/ASSESSMENTS.md). Owned by shared/assessments. A question bank tagged with Bloom
-- level, difficulty and (for HE) a CO code; question papers built from it. A paper keeps its own
-- copy of each question, so editing the bank never changes a paper already set.

CREATE TABLE assessment_question (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 2 AND 80),
  topic text CHECK (topic IS NULL OR length(btrim(topic)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('mcq', 'short', 'long')),
  prompt text NOT NULL CHECK (length(btrim(prompt)) BETWEEN 3 AND 4000),
  options text[] NOT NULL DEFAULT '{}',
  answer text CHECK (answer IS NULL OR length(answer) <= 4000),
  marks numeric(5, 2) NOT NULL CHECK (marks > 0 AND marks <= 100),
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  bloom text NOT NULL CHECK (bloom IN ('remember', 'understand', 'apply', 'analyse', 'evaluate', 'create')),
  co_code text CHECK (co_code IS NULL OR co_code ~ '^[A-Za-z0-9.-]{1,20}$'),
  created_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id),
  -- A multiple-choice question has 2–6 options and its answer is one of them.
  CHECK ((kind = 'mcq') = (cardinality(options) BETWEEN 2 AND 6)),
  CHECK (kind <> 'mcq' OR answer = ANY (options))
);
CREATE INDEX assessment_question_subject_idx ON assessment_question (org_id, institution_id, subject);

CREATE TABLE assessment_paper (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 160),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 2 AND 80),
  minutes integer CHECK (minutes IS NULL OR minutes BETWEEN 5 AND 600),
  instructions text CHECK (instructions IS NULL OR length(instructions) <= 2000),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'final')),
  created_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalised_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id),
  CHECK ((state = 'final') = (finalised_at IS NOT NULL))
);
CREATE INDEX assessment_paper_institution_idx ON assessment_paper (org_id, institution_id);

-- The paper's own copy of each question, as it was when added.
CREATE TABLE assessment_paper_item (
  org_id uuid NOT NULL REFERENCES organisation (id),
  paper_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  question_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mcq', 'short', 'long')),
  prompt text NOT NULL,
  options text[] NOT NULL DEFAULT '{}',
  answer text,
  marks numeric(5, 2) NOT NULL CHECK (marks > 0),
  difficulty text NOT NULL,
  bloom text NOT NULL,
  co_code text,
  PRIMARY KEY (org_id, paper_id, position),
  UNIQUE (org_id, paper_id, question_id),
  FOREIGN KEY (org_id, paper_id) REFERENCES assessment_paper (org_id, id),
  FOREIGN KEY (org_id, question_id) REFERENCES assessment_question (org_id, id)
);

-- A final paper's items never change.
CREATE FUNCTION assessment_paper_item_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM assessment_paper p
             WHERE p.org_id = COALESCE(NEW.org_id, OLD.org_id)
               AND p.id = COALESCE(NEW.paper_id, OLD.paper_id) AND p.state = 'final') THEN
    RAISE EXCEPTION 'assessment paper is final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER assessment_paper_item_frozen BEFORE INSERT OR UPDATE OR DELETE ON assessment_paper_item
  FOR EACH ROW EXECUTE FUNCTION assessment_paper_item_frozen();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assessment_question', 'assessment_paper', 'assessment_paper_item'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON assessment_question, assessment_paper TO cv_app;
GRANT SELECT, INSERT, DELETE ON assessment_paper_item TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue).
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'assessment.bank.manage' FROM role r
WHERE r.key IN ('owner', 'school_admin', 'principal', 'teacher')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
