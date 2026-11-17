-- Library, step 1 (docs/specs/LIBRARY.md). Owned by shared/library.

CREATE TABLE library_settings (
  org_id uuid NOT NULL REFERENCES organisation (id),
  institution_id uuid NOT NULL,
  student_loan_days smallint NOT NULL DEFAULT 14 CHECK (student_loan_days BETWEEN 1 AND 365),
  staff_loan_days smallint NOT NULL DEFAULT 30 CHECK (staff_loan_days BETWEEN 1 AND 365),
  student_limit smallint NOT NULL DEFAULT 2 CHECK (student_limit BETWEEN 1 AND 50),
  staff_limit smallint NOT NULL DEFAULT 5 CHECK (staff_limit BETWEEN 1 AND 50),
  renewals smallint NOT NULL DEFAULT 1 CHECK (renewals BETWEEN 0 AND 10),
  fine_per_day_paise integer NOT NULL DEFAULT 0 CHECK (fine_per_day_paise BETWEEN 0 AND 100000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, institution_id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);

CREATE TABLE library_title (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  authors text NOT NULL DEFAULT '' CHECK (length(authors) <= 300),
  isbn text CHECK (isbn ~ '^[0-9]{9}[0-9X]$|^[0-9]{13}$'),
  publisher text NOT NULL DEFAULT '' CHECK (length(publisher) <= 200),
  year smallint CHECK (year BETWEEN 1500 AND 2100),
  subject text NOT NULL DEFAULT '' CHECK (length(subject) <= 100),
  language text NOT NULL DEFAULT '' CHECK (length(language) <= 50),
  shelf text NOT NULL DEFAULT '' CHECK (length(shelf) <= 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);
CREATE INDEX library_title_search_idx ON library_title (org_id, institution_id, lower(title));

CREATE TABLE library_copy (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  title_id uuid NOT NULL,
  accession_no text NOT NULL CHECK (accession_no ~ '^[A-Za-z0-9/-]{1,20}$'),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'on_loan', 'lost', 'withdrawn')),
  acquired_on date,
  price_paise integer CHECK (price_paise >= 0),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, title_id) REFERENCES library_title (org_id, id)
);
CREATE UNIQUE INDEX library_copy_accession ON library_copy (org_id, institution_id, upper(accession_no));
CREATE INDEX library_copy_title_idx ON library_copy (org_id, title_id);

CREATE TABLE library_loan (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  copy_id uuid NOT NULL,
  borrower_person_id uuid NOT NULL,
  borrower_kind text NOT NULL CHECK (borrower_kind IN ('student', 'staff')),
  issued_on date NOT NULL,
  due_on date NOT NULL,
  renewals smallint NOT NULL DEFAULT 0 CHECK (renewals >= 0),
  returned_on date,
  outcome text CHECK (outcome IN ('returned', 'lost')),
  issued_by_person_id uuid NOT NULL,
  returned_by_person_id uuid,
  fine_paise integer NOT NULL DEFAULT 0 CHECK (fine_paise >= 0),
  fine_state text NOT NULL DEFAULT 'none' CHECK (fine_state IN ('none', 'owed', 'waived')),
  waive_reason text CHECK (length(waive_reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, copy_id) REFERENCES library_copy (org_id, id),
  FOREIGN KEY (org_id, borrower_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, issued_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, returned_by_person_id) REFERENCES person (org_id, id),
  CHECK (due_on >= issued_on),
  CHECK ((returned_on IS NULL) = (outcome IS NULL)),
  CHECK (fine_state <> 'waived' OR waive_reason IS NOT NULL),
  CHECK (fine_state = 'none' OR returned_on IS NOT NULL)
);
-- One open loan per copy.
CREATE UNIQUE INDEX library_loan_open ON library_loan (org_id, copy_id) WHERE returned_on IS NULL;
CREATE INDEX library_loan_borrower_idx ON library_loan (org_id, borrower_person_id, returned_on);
CREATE INDEX library_loan_due_idx ON library_loan (org_id, institution_id, due_on) WHERE returned_on IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['library_settings', 'library_title', 'library_copy', 'library_loan'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON library_settings, library_title, library_copy, library_loan TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue)
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('library.book.read'), ('library.book.manage')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal', 'office')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'library.book.read' FROM role r WHERE r.key = 'teacher'
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'library.book.read', 'guardian' FROM role r WHERE r.key = 'parent'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
