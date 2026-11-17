-- Staff work email from the import, used to invite staff to Google sign-in.
ALTER TABLE staff_profile ADD COLUMN work_email text
  CHECK (work_email IS NULL OR (work_email = lower(work_email) AND work_email ~ '^[^@\s]+@[^@\s]+$'));
