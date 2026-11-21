-- Each academic year has its own structure, and fees belong to a year (owner's brief, 20 Nov 2026).
--
-- school/setup: a section can be closed (it keeps its students and history, takes no new ones);
-- a section nobody has used yet can be removed, with its teacher allocations; a class that stops
-- running in a year loses that year's subject offerings.
--
-- shared/finance: a fee plan names the period (the school's academic year, from the audience
-- port) it bills for. Existing plans take the year their first instalment falls in; plans with no
-- such year stay unlinked and work as before.

ALTER TABLE school_section
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by_person_id uuid,
  ADD CONSTRAINT school_section_closer_fk FOREIGN KEY (org_id, closed_by_person_id) REFERENCES person (org_id, id),
  ADD CONSTRAINT school_section_closed CHECK ((closed_at IS NULL) = (closed_by_person_id IS NULL));

GRANT DELETE ON school_section, school_teacher_allocation TO cv_app;

ALTER TABLE fee_plan
  ADD COLUMN period_id uuid,
  ADD COLUMN period_label text CHECK (period_label ~ '^\d{4}-\d{2}$'),
  ADD CONSTRAINT fee_plan_period CHECK ((period_id IS NULL) = (period_label IS NULL));
CREATE INDEX fee_plan_period_idx ON fee_plan (org_id, institution_id, period_id);

UPDATE fee_plan p SET period_id = y.id, period_label = y.label
FROM school_year y
WHERE y.org_id = p.org_id AND y.institution_id = p.institution_id
  AND y.valid_during @> (
    SELECT min(i.due_on) FROM fee_instalment i WHERE i.org_id = p.org_id AND i.plan_id = p.id
  );
