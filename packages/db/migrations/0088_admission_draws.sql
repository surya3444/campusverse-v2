-- Enrollment › Merit & Seat Allocation for schools (rule book §13.1, §16.2; P1 item 20;
-- docs/specs/SEAT_DRAWS.md). Owned by school/admissions. A draw ranks the eligible applicants for
-- one class and category (an RTE 12(1)(c) lottery, or first come with sibling priority) from a
-- recorded seed and frozen inputs, so anyone can run it again and get the same order. Someone other
-- than the person who drew it publishes it: offers for the free seats, the rest waitlisted in order.
-- Every draw is kept, discarded ones too, so a re-draw can't hide.

CREATE TABLE school_admission_draw (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  year_label text NOT NULL CHECK (year_label ~ '^\d{4}-\d{2}$'),
  class_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('general', 'rte', 'staff', 'management')),
  method text NOT NULL CHECK (method IN ('lottery', 'first_come')),
  sibling_first boolean NOT NULL,
  seed text NOT NULL CHECK (length(seed) BETWEEN 1 AND 64),
  -- The inputs exactly as drawn: [{id, sibling, appliedAt}], and who was left out and why.
  pool jsonb NOT NULL,
  left_out jsonb NOT NULL DEFAULT '[]',
  ranked uuid[] NOT NULL,
  seats_free integer NOT NULL CHECK (seats_free >= 0),
  state text NOT NULL DEFAULT 'drawn' CHECK (state IN ('drawn', 'published', 'discarded')),
  drawn_by_person_id uuid NOT NULL,
  drawn_at timestamptz NOT NULL DEFAULT now(),
  decided_by_person_id uuid,
  decided_at timestamptz,
  discard_reason text CHECK (discard_reason IS NULL OR length(btrim(discard_reason)) BETWEEN 3 AND 500),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, class_id) REFERENCES school_class (org_id, id),
  FOREIGN KEY (org_id, drawn_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, decided_by_person_id) REFERENCES person (org_id, id),
  CHECK ((state = 'drawn') = (decided_at IS NULL)),
  CHECK ((state = 'discarded') = (discard_reason IS NOT NULL)),
  -- Two people: whoever drew it never publishes it.
  CHECK (state <> 'published' OR decided_by_person_id <> drawn_by_person_id)
);
-- One undecided draw per class and category at a time.
CREATE UNIQUE INDEX school_admission_draw_open_idx ON school_admission_draw
  (org_id, institution_id, year_label, class_id, category) WHERE state = 'drawn';
CREATE INDEX school_admission_draw_year_idx ON school_admission_draw (org_id, institution_id, year_label);

-- The inputs, seed and order never change; only the decision is written once.
CREATE FUNCTION school_admission_draw_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'drawn' OR NEW.seed <> OLD.seed OR NEW.pool <> OLD.pool OR NEW.ranked <> OLD.ranked
     OR NEW.left_out <> OLD.left_out OR NEW.method <> OLD.method OR NEW.sibling_first <> OLD.sibling_first
     OR NEW.seats_free <> OLD.seats_free THEN
    RAISE EXCEPTION 'admission draw is frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER school_admission_draw_frozen BEFORE UPDATE ON school_admission_draw
  FOR EACH ROW EXECUTE FUNCTION school_admission_draw_frozen();

ALTER TABLE school_admission_draw ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_admission_draw FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_admission_draw USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON school_admission_draw TO cv_app;
