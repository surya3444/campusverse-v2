-- Academics › OBE (rule book §13.2: "Program Outcomes: vision, mission, PEOs, POs (versioned),
-- PSOs"; "Course Outcomes & Mapping: COs per course; CO–PO/PSO matrix (1–3)"; "Attainment: direct
-- from tagged items … targets and weights"; P1 item 17). PO and PSO attainment is worked out only
-- from CO attainment through the matrix, so COs and POs can never disagree (rule book §17 defect 1).
-- Owned by academics/obe.

-- A program's outcomes, as a numbered version: drafted, then published (frozen).
CREATE TABLE obe_outcome_set (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  program_id uuid NOT NULL,
  version smallint NOT NULL CHECK (version BETWEEN 1 AND 999),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  effective_from date NOT NULL,
  vision text CHECK (length(vision) <= 2000),
  mission text CHECK (length(mission) <= 2000),
  -- A student "achieves" an item from this share of its marks.
  target_percent numeric(5, 2) NOT NULL DEFAULT 60 CHECK (target_percent > 0 AND target_percent <= 100),
  -- Share of students achieving it for levels 1, 2 and 3.
  level1_percent numeric(5, 2) NOT NULL DEFAULT 50,
  level2_percent numeric(5, 2) NOT NULL DEFAULT 60,
  level3_percent numeric(5, 2) NOT NULL DEFAULT 70,
  -- Weight of internal assessment in a CO's direct attainment (the end exam has the rest).
  cie_weight numeric(5, 2) NOT NULL DEFAULT 40 CHECK (cie_weight BETWEEN 0 AND 100),
  -- The level every CO, PO and PSO is held to (one target, so they agree).
  target_level numeric(3, 2) NOT NULL DEFAULT 2 CHECK (target_level > 0 AND target_level <= 3),
  created_by_person_id uuid NOT NULL,
  published_at timestamptz,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, program_id, version),
  FOREIGN KEY (org_id, program_id) REFERENCES academic_program (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id),
  CHECK (level1_percent < level2_percent AND level2_percent < level3_percent AND level3_percent <= 100),
  CHECK ((status = 'published') = (published_at IS NOT NULL))
);
CREATE UNIQUE INDEX obe_outcome_set_draft_idx ON obe_outcome_set (org_id, program_id) WHERE status = 'draft';

CREATE TABLE obe_outcome (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  set_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('peo', 'po', 'pso')),
  code text NOT NULL CHECK (code ~ '^[A-Z]{2,4}[0-9]{1,2}$'),
  statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 3 AND 600),
  position smallint NOT NULL,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, set_id, code),
  FOREIGN KEY (org_id, set_id) REFERENCES obe_outcome_set (org_id, id) ON DELETE CASCADE
);

-- A published set never changes.
CREATE FUNCTION obe_outcome_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM obe_outcome_set s WHERE s.org_id = COALESCE(NEW.org_id, OLD.org_id)
             AND s.id = COALESCE(NEW.set_id, OLD.set_id) AND s.status = 'published') THEN
    RAISE EXCEPTION 'outcome set is published' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER frozen BEFORE INSERT OR UPDATE OR DELETE ON obe_outcome
  FOR EACH ROW EXECUTE FUNCTION obe_outcome_frozen();

-- Course outcomes, per course of a regulation (the course's content is the regulation's).
CREATE TABLE obe_course_outcome (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  regulation_id uuid NOT NULL,
  course_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^CO[0-9]{1,2}$'),
  statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 3 AND 600),
  position smallint NOT NULL,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, regulation_id, course_id, code),
  FOREIGN KEY (org_id, regulation_id, course_id) REFERENCES academic_curriculum (org_id, regulation_id, course_id)
);

-- The CO–PO/PSO matrix: how strongly a CO serves an outcome (1 low, 2 medium, 3 high).
CREATE TABLE obe_co_mapping (
  org_id uuid NOT NULL REFERENCES organisation (id),
  course_outcome_id uuid NOT NULL,
  outcome_id uuid NOT NULL,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  PRIMARY KEY (org_id, course_outcome_id, outcome_id),
  FOREIGN KEY (org_id, course_outcome_id) REFERENCES obe_course_outcome (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, outcome_id) REFERENCES obe_outcome (org_id, id) ON DELETE CASCADE
);

-- Which assessment items measure a CO: the end exam ('see'), the internal mark ('cie'), or one
-- internal component ('cie:0', 'cie:1' … by its place in the course's plan).
CREATE TABLE obe_item_tag (
  org_id uuid NOT NULL REFERENCES organisation (id),
  course_outcome_id uuid NOT NULL,
  item text NOT NULL CHECK (item ~ '^(see|cie|cie:[0-7])$'),
  PRIMARY KEY (org_id, course_outcome_id, item),
  FOREIGN KEY (org_id, course_outcome_id) REFERENCES obe_course_outcome (org_id, id) ON DELETE CASCADE
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['obe_outcome_set', 'obe_outcome', 'obe_course_outcome', 'obe_co_mapping', 'obe_item_tag'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO cv_app', t);
  END LOOP;
END $$;

-- Permissions (also in SCHOOL_ROLES and the access catalogue).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('academics.obe.read'), ('academics.obe.manage')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'academics.obe.read' FROM role r WHERE r.key = 'teacher'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
