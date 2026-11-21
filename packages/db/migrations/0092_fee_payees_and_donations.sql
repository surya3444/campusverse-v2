-- Fees collected for others, and voluntary donations (owner's brief, 21 Nov 2026; rule book §13
-- Finance: fee heads, "Fund Accounting: separate funds for trusts", "Alumni Giving: donations with
-- receipts through Accounts"). Owned by shared/finance.
--
-- 1. A payee is an outside body the institution collects part of its fees for: the affiliating
--    university (VTU's fee inside an engineering college's fee), a board, the government. A fee
--    head is either the institution's own (payee_id null) or collected for one payee.
-- 2. Each allocation of a payment to an invoice is split by payee when it is made, so a receipt
--    shows the split and the money held for a payee is known to the paisa. Outside payees are
--    filled first. Existing allocations stay the institution's own (no payees existed before).
-- 3. A remittance records money paid on to a payee, with its bank reference. Append-only.
-- 4. Donations: voluntary gifts to the institution's legal entity, with their own gapless receipt
--    series per legal entity and financial year. Never a fee and never linked to a seat: a
--    capitation fee is unlawful (RTE Act 2009 s.13; state capitation fee acts). A donation can be
--    cancelled with a reason, never edited or deleted.

CREATE TABLE fee_payee (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('university', 'board', 'government', 'other')),
  name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
  short_name text NOT NULL CHECK (btrim(short_name) <> '' AND length(short_name) <= 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  UNIQUE (org_id, institution_id, short_name)
);

ALTER TABLE fee_head
  ADD COLUMN payee_id uuid,
  ADD CONSTRAINT fee_head_payee_fk FOREIGN KEY (org_id, payee_id) REFERENCES fee_payee (org_id, id);

ALTER TABLE fee_allocation
  ADD COLUMN payee_id uuid,
  ADD CONSTRAINT fee_allocation_payee_fk FOREIGN KEY (org_id, payee_id) REFERENCES fee_payee (org_id, id);
CREATE INDEX fee_allocation_payee_idx ON fee_allocation (org_id, payee_id) WHERE payee_id IS NOT NULL;
CREATE INDEX fee_allocation_invoice_idx ON fee_allocation (org_id, invoice_id);

CREATE TABLE fee_remittance (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  payee_id uuid NOT NULL,
  -- The academic year the money was collected for, when the plans name one.
  period_label text CHECK (period_label ~ '^\d{4}-\d{2}$'),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  paid_on date NOT NULL,
  reference text NOT NULL CHECK (btrim(reference) <> '' AND length(reference) <= 60),
  note text CHECK (length(note) <= 500),
  recorded_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, payee_id) REFERENCES fee_payee (org_id, id),
  FOREIGN KEY (org_id, recorded_by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX fee_remittance_payee_idx ON fee_remittance (org_id, payee_id, paid_on);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON fee_remittance
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON fee_remittance
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

-- Gapless donation receipt numbers per legal entity and financial year, under a row lock.
CREATE TABLE donation_counter (
  org_id uuid NOT NULL REFERENCES organisation (id),
  legal_entity_id uuid NOT NULL,
  financial_year text NOT NULL CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  PRIMARY KEY (org_id, legal_entity_id, financial_year),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES legal_entity (org_id, id)
);

CREATE TABLE donation (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  legal_entity_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  financial_year text NOT NULL CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  number integer NOT NULL CHECK (number >= 1),
  donor_kind text NOT NULL CHECK (donor_kind IN ('person', 'organisation')),
  donor_name text NOT NULL CHECK (btrim(donor_name) <> '' AND length(donor_name) <= 120),
  donor_phone text CHECK (donor_phone ~ '^\+91[6-9][0-9]{9}$'),
  donor_email text CHECK (donor_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND donor_email = lower(donor_email)),
  donor_address text CHECK (length(donor_address) <= 300),
  -- What it is for: the general fund, or one the trust names (building, library, scholarships).
  fund text NOT NULL CHECK (btrim(fund) <> '' AND length(fund) <= 60),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  method text NOT NULL CHECK (method IN ('cash', 'cheque', 'upi', 'card', 'netbanking', 'bank_transfer')),
  instrument_ref text CHECK (length(instrument_ref) <= 60),
  received_on date NOT NULL,
  note text CHECK (length(note) <= 500),
  recorded_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by_person_id uuid,
  cancel_reason text,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES legal_entity (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, recorded_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, cancelled_by_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, legal_entity_id, financial_year, number),
  -- A person gives a phone or email, so the "no application in progress" check can run.
  CHECK (donor_kind = 'organisation' OR donor_phone IS NOT NULL OR donor_email IS NOT NULL),
  CHECK (method = 'cash' OR instrument_ref IS NOT NULL),
  CHECK ((cancelled_at IS NULL) = (cancelled_by_person_id IS NULL)),
  CHECK ((cancelled_at IS NULL) = (cancel_reason IS NULL)),
  CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) >= 3)
);
CREATE INDEX donation_institution_idx ON donation (org_id, institution_id, received_on);

-- Only cancellation may change a donation, once.
CREATE FUNCTION donation_cancel_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancelled_at IS NOT NULL
    OR (to_jsonb(NEW) - 'cancelled_at' - 'cancelled_by_person_id' - 'cancel_reason')
      <> (to_jsonb(OLD) - 'cancelled_at' - 'cancelled_by_person_id' - 'cancel_reason') THEN
    RAISE EXCEPTION 'a donation is only ever cancelled, once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER donation_cancel_only BEFORE UPDATE ON donation
  FOR EACH ROW EXECUTE FUNCTION donation_cancel_only();
CREATE TRIGGER append_only BEFORE DELETE ON donation
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON donation
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_payee', 'fee_remittance', 'donation_counter', 'donation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON fee_payee, fee_remittance TO cv_app;
GRANT SELECT, INSERT, UPDATE ON donation_counter, donation TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue)
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('finance.remittance.record'), ('finance.donation.read'), ('finance.donation.record')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal', 'office')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'finance.donation.cancel' FROM role r WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
