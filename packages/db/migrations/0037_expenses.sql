-- Expenses and purchases, step 1 (docs/specs/EXPENSES.md). Owned by shared/expenses.

CREATE TABLE expense_category (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);
CREATE UNIQUE INDEX expense_category_name ON expense_category (org_id, lower(btrim(name)));

CREATE TABLE expense_vendor (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  phone text CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  email text CHECK (length(email) <= 200 AND email ~ '^[^@\s]+@[^@\s]+$'),
  gstin text CHECK (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  address text NOT NULL DEFAULT '' CHECK (length(address) <= 500),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);
CREATE INDEX expense_vendor_name_idx ON expense_vendor (org_id, lower(name));

CREATE TABLE expense_budget (
  org_id uuid NOT NULL REFERENCES organisation (id),
  institution_id uuid NOT NULL,
  category_id uuid NOT NULL,
  financial_year text NOT NULL CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, institution_id, category_id, financial_year),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, category_id) REFERENCES expense_category (org_id, id)
);

CREATE TABLE expense_bill (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  financial_year text NOT NULL CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  category_id uuid NOT NULL,
  vendor_id uuid,
  payee text NOT NULL DEFAULT '' CHECK (length(payee) <= 200),
  bill_no text NOT NULL DEFAULT '' CHECK (length(bill_no) <= 50),
  bill_date date NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  tax_paise bigint NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  file_id uuid,
  state text NOT NULL DEFAULT 'submitted'
    CHECK (state IN ('submitted', 'approved', 'rejected', 'paid', 'cancelled')),
  recorded_by_person_id uuid NOT NULL,
  decided_by_person_id uuid,
  decided_at timestamptz,
  decision_note text CHECK (length(decision_note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES legal_entity (org_id, id),
  FOREIGN KEY (org_id, category_id) REFERENCES expense_category (org_id, id),
  FOREIGN KEY (org_id, vendor_id) REFERENCES expense_vendor (org_id, id),
  FOREIGN KEY (org_id, file_id) REFERENCES stored_file (org_id, id),
  FOREIGN KEY (org_id, recorded_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, decided_by_person_id) REFERENCES person (org_id, id),
  CHECK (tax_paise <= amount_paise),
  -- Paid to a vendor on record, or to a named payee.
  CHECK (vendor_id IS NOT NULL OR length(btrim(payee)) > 0),
  -- Maker and checker are different people.
  CHECK (decided_by_person_id IS DISTINCT FROM recorded_by_person_id),
  CHECK ((decided_by_person_id IS NULL) = (decided_at IS NULL)),
  CHECK (state NOT IN ('approved', 'rejected', 'paid') OR decided_by_person_id IS NOT NULL),
  CHECK (state <> 'rejected' OR length(btrim(decision_note)) >= 3)
);
-- The same vendor's bill can't be recorded twice, unless the first was cancelled.
CREATE UNIQUE INDEX expense_bill_vendor_no ON expense_bill (org_id, vendor_id, upper(btrim(bill_no)))
  WHERE vendor_id IS NOT NULL AND bill_no <> '' AND state <> 'cancelled';
CREATE INDEX expense_bill_state_idx ON expense_bill (org_id, institution_id, state);
CREATE INDEX expense_bill_year_idx ON expense_bill (org_id, institution_id, financial_year, category_id);

CREATE TABLE expense_voucher_counter (
  org_id uuid NOT NULL REFERENCES organisation (id),
  legal_entity_id uuid NOT NULL,
  financial_year text NOT NULL CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number > 0),
  PRIMARY KEY (org_id, legal_entity_id, financial_year),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES legal_entity (org_id, id)
);

-- Append-only: a wrong payment is reversed (step 2), never edited.
CREATE TABLE expense_payment (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  bill_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  financial_year text NOT NULL CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  voucher_no text NOT NULL CHECK (voucher_no ~ '^PV/\d{4}-\d{2}/\d{6}$'),
  mode text NOT NULL CHECK (mode IN ('cash', 'bank_transfer', 'cheque', 'upi', 'card')),
  reference text NOT NULL DEFAULT '' CHECK (length(reference) <= 100),
  paid_on date NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  paid_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, bill_id),
  UNIQUE (org_id, legal_entity_id, financial_year, voucher_no),
  FOREIGN KEY (org_id, bill_id) REFERENCES expense_bill (org_id, id),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES legal_entity (org_id, id),
  FOREIGN KEY (org_id, paid_by_person_id) REFERENCES person (org_id, id),
  CHECK (mode = 'cash' OR length(btrim(reference)) > 0)
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON expense_payment
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON expense_payment
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_category', 'expense_vendor', 'expense_budget', 'expense_bill',
    'expense_voucher_counter', 'expense_payment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON expense_category, expense_vendor, expense_budget, expense_bill,
  expense_voucher_counter TO cv_app;
GRANT SELECT, INSERT ON expense_payment TO cv_app;

-- The default categories for existing organisations (new ones get them when set up).
INSERT INTO expense_category (org_id, name)
SELECT o.id, c.name FROM organisation o
CROSS JOIN (VALUES ('Electricity and water'), ('Repairs and maintenance'), ('Stationery and printing'),
  ('Fuel and vehicle upkeep'), ('Events and functions'), ('Cleaning and housekeeping'), ('Internet and phone'),
  ('Rent'), ('Teaching materials'), ('Other')) AS c (name)
ON CONFLICT DO NOTHING;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue)
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('expenses.bill.read'), ('expenses.bill.record')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal', 'office')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('expenses.bill.approve'), ('expenses.setup.manage')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'expenses.bill.pay' FROM role r WHERE r.key IN ('owner', 'school_admin', 'office')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
