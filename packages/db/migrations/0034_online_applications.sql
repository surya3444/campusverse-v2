-- Online application forms, step 1 (docs/specs/ONLINE_APPLICATIONS.md). Owned by school/admissions.

CREATE TABLE school_admission_form (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  year_label text NOT NULL CHECK (year_label ~ '^\d{4}-\d{2}$'),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  intro text NOT NULL DEFAULT '' CHECK (length(intro) <= 600),
  class_ids uuid[] NOT NULL CHECK (cardinality(class_ids) >= 1),
  open boolean NOT NULL DEFAULT true,
  closes_on date,
  created_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, institution_id, year_label),
  UNIQUE (org_id, slug),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id)
);
ALTER TABLE school_admission_form ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_admission_form FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_admission_form USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON school_admission_form TO cv_app;

-- An online application has no staff creator; it carries what the family quotes and when they consented.
ALTER TABLE school_application ALTER COLUMN created_by_person_id DROP NOT NULL;
ALTER TABLE school_application ADD CONSTRAINT school_application_creator
  CHECK (created_by_person_id IS NOT NULL OR source = 'website');
ALTER TABLE school_application ADD COLUMN form_id uuid;
ALTER TABLE school_application ADD CONSTRAINT school_application_form_fk
  FOREIGN KEY (org_id, form_id) REFERENCES school_admission_form (org_id, id);
ALTER TABLE school_application ADD COLUMN public_ref text CHECK (public_ref ~ '^[A-Z2-9]{6}$');
ALTER TABLE school_application ADD COLUMN consented_at timestamptz;
CREATE UNIQUE INDEX school_application_public_ref ON school_application (org_id, public_ref);
ALTER TABLE school_application ADD CONSTRAINT school_application_online
  CHECK (form_id IS NULL OR (public_ref IS NOT NULL AND consented_at IS NOT NULL));

-- ops: the public page arrives before we know the tenant. Slug and ids only.
CREATE TABLE ops.admission_form_ref (
  slug text PRIMARY KEY,
  org_id uuid NOT NULL,
  form_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON ops.admission_form_ref TO cv_app;
