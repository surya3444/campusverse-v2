-- The lifelong learner record's identifiers (rule book §13.5, P0 item 4): PEN beside APAAR and
-- Aadhaar. PEN is UDISE+'s 11-digit Permanent Education Number, printed on the transfer
-- certificate, so it is kept in clear. The ABC ID (Academic Bank of Credits) is sealed like APAAR.
-- Owned by people/records. Both are optional and never block admission.
ALTER TABLE student_profile
  ADD COLUMN pen text,
  ADD COLUMN abc_sealed bytea,
  ADD COLUMN abc_last4 text;
ALTER TABLE student_profile
  ADD CONSTRAINT student_profile_pen_check CHECK (pen ~ '^\d{11}$') NOT VALID,
  ADD CONSTRAINT student_profile_abc_last4_check CHECK (abc_last4 ~ '^\d{4}$') NOT VALID,
  ADD CONSTRAINT student_profile_abc_pair CHECK ((abc_sealed IS NULL) = (abc_last4 IS NULL)) NOT VALID;
-- New columns are empty, so validating is instant.
ALTER TABLE student_profile VALIDATE CONSTRAINT student_profile_pen_check;
ALTER TABLE student_profile VALIDATE CONSTRAINT student_profile_abc_last4_check;
ALTER TABLE student_profile VALIDATE CONSTRAINT student_profile_abc_pair;
