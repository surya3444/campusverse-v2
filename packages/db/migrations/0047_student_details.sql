-- Connected school (docs/specs/CONNECTED_SCHOOL.md): the student details schools are asked for by
-- UDISE+, transfer certificates, scholarships and the admission register. Core data, so it lives
-- in the student's own profile, never in owner-defined fields (decision 0020). Social category and
-- medical notes are sensitive: only people with the full record see them.
ALTER TABLE student_profile
  ADD COLUMN blood_group text CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  ADD COLUMN mother_tongue text CHECK (length(mother_tongue) <= 40),
  ADD COLUMN religion text CHECK (length(religion) <= 40),
  ADD COLUMN social_category text CHECK (social_category IN ('general', 'obc', 'sc', 'st', 'ews', 'not_stated')),
  ADD COLUMN nationality text NOT NULL DEFAULT 'Indian' CHECK (btrim(nationality) <> '' AND length(nationality) <= 40),
  ADD COLUMN place_of_birth text CHECK (length(place_of_birth) <= 80),
  ADD COLUMN address_line text CHECK (length(address_line) <= 300),
  ADD COLUMN city text CHECK (length(city) <= 80),
  ADD COLUMN pincode text CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  ADD COLUMN state_code text CHECK (state_code ~ '^[A-Z]{2}$'),
  ADD COLUMN previous_school text CHECK (length(previous_school) <= 160),
  ADD COLUMN disability text CHECK (length(disability) <= 200),
  ADD COLUMN medical_notes text CHECK (length(medical_notes) <= 500);
