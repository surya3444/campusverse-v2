-- no-transaction
-- One student per PEN in an organisation.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS student_profile_pen_unique
  ON student_profile (org_id, pen) WHERE pen IS NOT NULL;
