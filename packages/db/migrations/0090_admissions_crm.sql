-- Admissions as a module (owner's brief, 20 Nov 2026; rule book §13.3 Enrollment: Admissions CRM
-- with leads and sources, pipeline and follow-ups, bulk import and duplicate check; Applications
-- with multi-step forms, save and resume, documents check by a verification officer; Offers &
-- Onboarding with consent at entry). Owned by school/admissions, except person_contact (people/records).
--
-- 1. The application holds everything the family tells the school, so enrolment can carry all of
--    it to the student's record: a second guardian, emails, the child's background and address.
--    Lead work: an owner (counsellor), interest, a campaign tag, the import it came from.
-- 2. Activity (calls, messages, visits, notes; append-only) and follow-ups (due, assigned, done).
-- 3. Personal form links sent to a family by SMS, WhatsApp or email (only the token's hash kept):
--    to apply, or to send the papers the office asked for. Opened and submitted are recorded.
-- 4. Papers can come from the family through the form (no uploader person); verification records
--    who verified the application and when.
-- 5. Each form lists the papers it asks for and which optional sections it shows.
-- 6. Bulk uploads of leads, each a batch that can be undone while untouched.
-- 7. Guardians' email addresses become contacts.

ALTER TABLE school_application
  ADD COLUMN guardian_email text CHECK (guardian_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(guardian_email) <= 200),
  ADD COLUMN second_guardian_name text CHECK (length(btrim(second_guardian_name)) BETWEEN 2 AND 120),
  ADD COLUMN second_guardian_relationship text CHECK (second_guardian_relationship ~ '^[a-z_]{2,20}$'),
  ADD COLUMN second_guardian_phone text CHECK (second_guardian_phone ~ '^\+91[6-9][0-9]{9}$'),
  ADD COLUMN second_guardian_email text CHECK (second_guardian_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(second_guardian_email) <= 200),
  ADD COLUMN blood_group text CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  ADD COLUMN mother_tongue text CHECK (length(mother_tongue) <= 40),
  ADD COLUMN religion text CHECK (length(religion) <= 40),
  ADD COLUMN social_category text CHECK (social_category IN ('general', 'obc', 'sc', 'st', 'ews', 'not_stated')),
  ADD COLUMN nationality text CHECK (length(btrim(nationality)) BETWEEN 1 AND 40),
  ADD COLUMN place_of_birth text CHECK (length(place_of_birth) <= 80),
  ADD COLUMN address_line text CHECK (length(address_line) <= 300),
  ADD COLUMN city text CHECK (length(city) <= 80),
  ADD COLUMN pincode text CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  ADD COLUMN state_code text CHECK (state_code ~ '^[A-Z]{2}$'),
  ADD COLUMN disability text CHECK (length(disability) <= 200),
  ADD COLUMN medical_notes text CHECK (length(medical_notes) <= 500),
  ADD COLUMN owner_person_id uuid,
  ADD COLUMN interest text CHECK (interest IN ('hot', 'warm', 'cold')),
  ADD COLUMN campaign text CHECK (length(btrim(campaign)) BETWEEN 1 AND 60),
  ADD COLUMN import_batch_id uuid,
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verified_by_person_id uuid,
  ADD CONSTRAINT school_application_owner_fk FOREIGN KEY (org_id, owner_person_id) REFERENCES person (org_id, id),
  ADD CONSTRAINT school_application_verifier_fk FOREIGN KEY (org_id, verified_by_person_id) REFERENCES person (org_id, id),
  ADD CONSTRAINT school_application_second_guardian CHECK (
    (second_guardian_name IS NULL) = (second_guardian_relationship IS NULL)
    AND (second_guardian_name IS NOT NULL OR (second_guardian_phone IS NULL AND second_guardian_email IS NULL))
  ),
  ADD CONSTRAINT school_application_verified CHECK ((verified_at IS NULL) = (verified_by_person_id IS NULL));

CREATE INDEX school_application_owner_idx ON school_application (org_id, owner_person_id) WHERE owner_person_id IS NOT NULL;

-- Calls, messages, visits and notes on a lead's timeline. Never edited or deleted.
CREATE TABLE school_admission_activity (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  application_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('call', 'whatsapp', 'sms', 'email', 'visit', 'note')),
  outcome text CHECK (outcome IN ('reached', 'no_answer', 'busy', 'call_back', 'interested', 'not_interested', 'visited')),
  note text CHECK (length(note) <= 1000),
  at timestamptz NOT NULL DEFAULT now(),
  by_person_id uuid NOT NULL,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, application_id) REFERENCES school_application (org_id, id),
  FOREIGN KEY (org_id, by_person_id) REFERENCES person (org_id, id),
  CHECK (outcome IS NOT NULL OR note IS NOT NULL)
);
CREATE INDEX school_admission_activity_idx ON school_admission_activity (org_id, application_id, at);

-- Follow-ups: what to do for a lead, by when, by whom; done with what happened.
CREATE TABLE school_admission_follow_up (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  application_id uuid NOT NULL,
  due_on date NOT NULL,
  purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 2 AND 200),
  assigned_to_person_id uuid NOT NULL,
  created_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  done_by_person_id uuid,
  outcome text CHECK (length(outcome) <= 500),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, application_id) REFERENCES school_application (org_id, id),
  FOREIGN KEY (org_id, assigned_to_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, done_by_person_id) REFERENCES person (org_id, id),
  CHECK ((done_at IS NULL) = (done_by_person_id IS NULL))
);
CREATE INDEX school_admission_follow_up_open_idx ON school_admission_follow_up (org_id, due_on) WHERE done_at IS NULL;
CREATE INDEX school_admission_follow_up_app_idx ON school_admission_follow_up (org_id, application_id);

-- Personal form links. A link to apply may be for a lead (its answers start filled in) or for a
-- new family; a link for papers is always for an application.
CREATE TABLE school_admission_invite (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  form_id uuid NOT NULL,
  application_id uuid,
  purpose text NOT NULL CHECK (purpose IN ('apply', 'papers')),
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email', 'link')),
  address text CHECK (
    (channel IN ('sms', 'whatsapp') AND address ~ '^\+91[6-9][0-9]{9}$')
    OR (channel = 'email' AND address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(address) <= 200)
    OR (channel = 'link' AND address IS NULL)
  ),
  child_name text CHECK (length(btrim(child_name)) BETWEEN 1 AND 120),
  guardian_name text CHECK (length(btrim(guardian_name)) BETWEEN 1 AND 120),
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  sent_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  submitted_at timestamptz,
  cancelled_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, form_id) REFERENCES school_admission_form (org_id, id),
  FOREIGN KEY (org_id, application_id) REFERENCES school_application (org_id, id),
  FOREIGN KEY (org_id, sent_by_person_id) REFERENCES person (org_id, id),
  CHECK (purpose = 'apply' OR application_id IS NOT NULL)
);
CREATE INDEX school_admission_invite_app_idx ON school_admission_invite (org_id, application_id);
CREATE INDEX school_admission_invite_inst_idx ON school_admission_invite (org_id, institution_id, created_at);

-- Papers from the family arrive with no uploader person.
ALTER TABLE school_application_document ALTER COLUMN uploaded_by_person_id DROP NOT NULL;
ALTER TABLE school_application_document
  ADD COLUMN uploaded_by_family boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT school_application_document_uploader CHECK (uploaded_by_person_id IS NOT NULL OR uploaded_by_family);

-- What each form asks for: its papers ({kind, title, required}) and its optional sections.
ALTER TABLE school_admission_form
  ADD COLUMN papers jsonb NOT NULL DEFAULT '[
    {"kind": "birth_certificate", "title": "Birth certificate", "required": true},
    {"kind": "photo", "title": "Passport-size photo", "required": true},
    {"kind": "address_proof", "title": "Address proof", "required": true},
    {"kind": "report_card", "title": "Last report card", "required": false},
    {"kind": "transfer_certificate", "title": "Transfer certificate", "required": false}
  ]' CHECK (jsonb_typeof(papers) = 'array' AND jsonb_array_length(papers) <= 12),
  ADD COLUMN sections text[] NOT NULL DEFAULT '{second_guardian,address,background,previous_school,health}'
    CHECK (sections <@ '{second_guardian,address,background,previous_school,health}'::text[]);

-- Bulk uploads of leads.
CREATE TABLE school_admission_import (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  year_label text NOT NULL CHECK (year_label ~ '^\d{4}-\d{2}$'),
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  source text NOT NULL CHECK (source IN ('walk_in', 'phone', 'website', 'referral', 'other')),
  campaign text CHECK (length(btrim(campaign)) BETWEEN 1 AND 60),
  owner_person_id uuid,
  total_rows integer NOT NULL CHECK (total_rows >= 0),
  imported_rows integer NOT NULL CHECK (imported_rows >= 0),
  skipped_rows integer NOT NULL CHECK (skipped_rows >= 0),
  created_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, owner_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id)
);
ALTER TABLE school_application
  ADD CONSTRAINT school_application_import_fk FOREIGN KEY (org_id, import_batch_id) REFERENCES school_admission_import (org_id, id);
CREATE INDEX school_application_import_idx ON school_application (org_id, import_batch_id) WHERE import_batch_id IS NOT NULL;

-- Email contacts for guardians (people/records); delivery uses them once an email provider exists.
ALTER TABLE person_contact DROP CONSTRAINT person_contact_channel_check;
ALTER TABLE person_contact ADD CONSTRAINT person_contact_channel_check
  CHECK (channel IN ('push', 'whatsapp', 'sms', 'email'));
ALTER TABLE person_contact DROP CONSTRAINT person_contact_check;
ALTER TABLE person_contact ADD CONSTRAINT person_contact_address_check CHECK (
  channel = 'push'
  OR (channel = 'email' AND address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND address = lower(address))
  OR (channel IN ('sms', 'whatsapp') AND address ~ '^\+91[6-9][0-9]{9}$')
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_admission_activity', 'school_admission_follow_up', 'school_admission_invite',
    'school_admission_import'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON school_admission_activity TO cv_app;
GRANT SELECT, INSERT, UPDATE ON school_admission_follow_up, school_admission_invite, school_admission_import TO cv_app;
