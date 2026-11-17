-- Appraisals, step 1 (docs/specs/APPRAISALS.md). Owned by people/appraisals.

CREATE TABLE appraisal_cycle (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
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

CREATE TABLE appraisal_criterion (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  cycle_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 30),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  weight smallint NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 5),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, cycle_id, position),
  FOREIGN KEY (org_id, cycle_id) REFERENCES appraisal_cycle (org_id, id)
);

CREATE TABLE appraisal_review (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  cycle_id uuid NOT NULL,
  person_id uuid NOT NULL,
  reviewer_person_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'self' CHECK (state IN ('self', 'review', 'done', 'acknowledged')),
  self_comment text NOT NULL DEFAULT '' CHECK (length(self_comment) <= 2000),
  reviewer_comment text NOT NULL DEFAULT '' CHECK (length(reviewer_comment) <= 2000),
  reply text NOT NULL DEFAULT '' CHECK (length(reply) <= 1000),
  score numeric(3, 2) CHECK (score BETWEEN 1 AND 5),
  self_at timestamptz,
  reviewed_at timestamptz,
  acknowledged_at timestamptz,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, cycle_id, person_id),
  FOREIGN KEY (org_id, cycle_id) REFERENCES appraisal_cycle (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, reviewer_person_id) REFERENCES person (org_id, id),
  CHECK (reviewer_person_id <> person_id),
  CHECK ((state IN ('done', 'acknowledged')) = (score IS NOT NULL))
);
CREATE INDEX appraisal_review_reviewer_idx ON appraisal_review (org_id, reviewer_person_id);
CREATE INDEX appraisal_review_person_idx ON appraisal_review (org_id, person_id);

CREATE TABLE appraisal_rating (
  org_id uuid NOT NULL REFERENCES organisation (id),
  review_id uuid NOT NULL,
  criterion_id uuid NOT NULL,
  by_role text NOT NULL CHECK (by_role IN ('self', 'reviewer')),
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (length(comment) <= 500),
  PRIMARY KEY (org_id, review_id, criterion_id, by_role),
  FOREIGN KEY (org_id, review_id) REFERENCES appraisal_review (org_id, id),
  FOREIGN KEY (org_id, criterion_id) REFERENCES appraisal_criterion (org_id, id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['appraisal_cycle', 'appraisal_criterion', 'appraisal_review', 'appraisal_rating'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON appraisal_cycle, appraisal_review, appraisal_rating TO cv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON appraisal_criterion TO cv_app;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'people.appraisal.manage' FROM role r WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'people.appraisal.self', 'self' FROM role r WHERE r.key <> 'parent'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
