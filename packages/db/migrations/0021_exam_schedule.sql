-- Milestone 22: the date sheet. Each paper's time, length, room and invigilator.
ALTER TABLE school_exam_paper
  ADD COLUMN starts_at time,
  ADD COLUMN duration_minutes integer CHECK (duration_minutes BETWEEN 5 AND 480),
  ADD COLUMN room text CHECK (room IS NULL OR length(room) <= 40),
  ADD COLUMN invigilator_person_id uuid;
ALTER TABLE school_exam_paper
  ADD FOREIGN KEY (org_id, invigilator_person_id) REFERENCES person (org_id, id);
GRANT SELECT, UPDATE ON school_exam_paper TO cv_app;
