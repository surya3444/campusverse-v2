-- Milestone 19, step 4 (docs/specs/TIMETABLE.md, decision 9): generating a timetable. The rules
-- the school sets travel with the version; each run is worked out by the worker and kept, so
-- "Place" writes exactly the preview the person saw.

-- Rules (validated by packages/contracts GenerateRules): mode, times a day, a teacher's limits,
-- per-subject doubles and time of day, per-teacher days off. {} means the defaults.
ALTER TABLE school_timetable ADD COLUMN generate_rules jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(generate_rules) = 'object');

CREATE TABLE school_timetable_generation (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  timetable_id uuid NOT NULL,
  -- The rules as they were, and a fingerprint of the draft's lessons when asked.
  rules jsonb NOT NULL,
  draft_stamp text NOT NULL,
  state text NOT NULL DEFAULT 'working' CHECK (state IN ('working', 'ready', 'placed', 'failed')),
  result jsonb,
  requested_by_person_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  placed_by_person_id uuid,
  placed_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, timetable_id) REFERENCES school_timetable (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, requested_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, placed_by_person_id) REFERENCES person (org_id, id),
  CHECK ((state IN ('ready', 'placed')) = (result IS NOT NULL)),
  CHECK ((state = 'placed') = (placed_at IS NOT NULL AND placed_by_person_id IS NOT NULL))
);
CREATE INDEX school_timetable_generation_timetable ON school_timetable_generation
  (org_id, timetable_id, requested_at DESC);

ALTER TABLE school_timetable_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_timetable_generation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_timetable_generation USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON school_timetable_generation TO cv_app;
