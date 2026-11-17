-- Fees (shared/finance): heads, versioned plans with instalments, invoices, concessions,
-- payments, immutable receipts numbered per legal entity and financial year, refunds, reversals
-- and day close. Money is bigint paise everywhere.

CREATE TABLE fee_head (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  -- Every head has a statutory class; a CA reviews the defaults before go-live.
  tax_class text NOT NULL DEFAULT 'education_exempt' CHECK (tax_class IN ('education_exempt', 'taxable')),
  rte_exempt boolean NOT NULL DEFAULT true,
  refundable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  UNIQUE (org_id, institution_id, code)
);

-- A plan is versioned: a fee change mid-year is a new version in the same family.
CREATE TABLE fee_plan (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  family_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  institution_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  -- Classes or sections, as the academic module names them (AudiencePort).
  group_ids uuid[] NOT NULL CHECK (cardinality(group_ids) > 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'retired')),
  late_fee_paise bigint NOT NULL DEFAULT 0 CHECK (late_fee_paise >= 0),
  grace_days integer NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 90),
  created_by_person_id uuid NOT NULL,
  published_by_person_id uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, family_id, version)
);
CREATE UNIQUE INDEX fee_plan_one_published ON fee_plan (org_id, family_id) WHERE state = 'published';

CREATE TABLE fee_plan_line (
  org_id uuid NOT NULL REFERENCES organisation (id),
  plan_id uuid NOT NULL,
  head_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  PRIMARY KEY (org_id, plan_id, head_id),
  FOREIGN KEY (org_id, plan_id) REFERENCES fee_plan (org_id, id),
  FOREIGN KEY (org_id, head_id) REFERENCES fee_head (org_id, id)
);

CREATE TABLE fee_instalment (
  org_id uuid NOT NULL REFERENCES organisation (id),
  plan_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq >= 1),
  label text NOT NULL CHECK (btrim(label) <> ''),
  due_on date NOT NULL,
  share_bp integer NOT NULL CHECK (share_bp BETWEEN 1 AND 10000),
  PRIMARY KEY (org_id, plan_id, seq),
  FOREIGN KEY (org_id, plan_id) REFERENCES fee_plan (org_id, id)
);

CREATE TABLE fee_invoice (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  legal_entity_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_family_id uuid NOT NULL,
  instalment_seq integer NOT NULL,
  label text NOT NULL,
  issued_on date NOT NULL,
  due_on date NOT NULL,
  -- issued / part_paid / paid / overdue follow the numbers; adjusted and written_off are explicit.
  state text NOT NULL DEFAULT 'issued'
    CHECK (state IN ('issued', 'part_paid', 'paid', 'overdue', 'adjusted', 'written_off')),
  total_paise bigint NOT NULL CHECK (total_paise >= 0),
  paid_paise bigint NOT NULL DEFAULT 0 CHECK (paid_paise >= 0),
  late_fee_applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES legal_entity (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, plan_id) REFERENCES fee_plan (org_id, id),
  -- Generating twice never bills twice, across plan versions too.
  UNIQUE (org_id, student_person_id, plan_family_id, instalment_seq)
);
CREATE INDEX fee_invoice_student_idx ON fee_invoice (org_id, student_person_id, due_on);
CREATE INDEX fee_invoice_due_idx ON fee_invoice (org_id, institution_id, due_on) WHERE paid_paise < total_paise;

-- Append-only: what makes up each invoice. Concessions are negative lines.
CREATE TABLE fee_invoice_line (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  invoice_id uuid NOT NULL,
  head_id uuid,
  kind text NOT NULL CHECK (kind IN ('charge', 'concession', 'late_fee', 'adjustment', 'bounce_charge')),
  amount_paise bigint NOT NULL,
  reason text,
  created_by_person_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, invoice_id) REFERENCES fee_invoice (org_id, id),
  FOREIGN KEY (org_id, head_id) REFERENCES fee_head (org_id, id),
  CHECK (kind <> 'concession' OR amount_paise <= 0),
  CHECK (kind NOT IN ('charge', 'late_fee', 'bounce_charge') OR amount_paise > 0),
  CHECK (kind <> 'adjustment' OR reason IS NOT NULL)
);
CREATE INDEX fee_invoice_line_invoice_idx ON fee_invoice_line (org_id, invoice_id);

-- Maker and checker are different people (CHECK below).
CREATE TABLE fee_concession (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  student_person_id uuid NOT NULL,
  head_id uuid,
  kind text NOT NULL CHECK (kind IN ('percent', 'amount')),
  value bigint NOT NULL CHECK (value > 0 AND (kind <> 'percent' OR value <= 10000)),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('rte', 'staff_child', 'sibling', 'merit', 'need', 'other')),
  valid_during daterange NOT NULL CHECK (NOT lower_inf(valid_during) AND NOT upper_inf(valid_during)),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'approved', 'rejected')),
  requested_by_person_id uuid NOT NULL,
  decided_by_person_id uuid,
  decided_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, head_id) REFERENCES fee_head (org_id, id),
  CHECK (decided_by_person_id IS DISTINCT FROM requested_by_person_id),
  CHECK ((state = 'requested') = (decided_at IS NULL))
);

CREATE TABLE fee_payment (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  legal_entity_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  method text NOT NULL CHECK (method IN ('cash', 'cheque', 'upi', 'card', 'netbanking', 'online')),
  state text NOT NULL DEFAULT 'initiated' CHECK (state IN (
    'initiated', 'pending', 'succeeded', 'failed', 'reversed', 'refunded', 'unmatched'
  )),
  -- Counter collections carry the client's Idempotency-Key: a retried request finds the same payment.
  idempotency_key text CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  gateway text,
  gateway_ref text,
  pay_url text,
  instrument_ref text CHECK (length(instrument_ref) <= 60),
  collected_by_person_id uuid,
  collected_on date,
  credit_paise bigint NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  succeeded_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES legal_entity (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, collected_by_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, idempotency_key),
  UNIQUE (org_id, gateway, gateway_ref),
  CHECK ((method = 'online') = (gateway IS NOT NULL))
);
CREATE INDEX fee_payment_student_idx ON fee_payment (org_id, student_person_id, created_at);
CREATE INDEX fee_payment_counter_idx ON fee_payment (org_id, collected_by_person_id, collected_on);

-- Append-only: how each payment was spread over invoices. A reversal adds negative rows.
CREATE TABLE fee_allocation (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  payment_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise <> 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, payment_id) REFERENCES fee_payment (org_id, id),
  FOREIGN KEY (org_id, invoice_id) REFERENCES fee_invoice (org_id, id)
);
CREATE INDEX fee_allocation_payment_idx ON fee_allocation (org_id, payment_id);

-- Gapless receipt numbers per legal entity and financial year, taken under a row lock.
CREATE TABLE fee_receipt_counter (
  org_id uuid NOT NULL REFERENCES organisation (id),
  legal_entity_id uuid NOT NULL,
  financial_year text NOT NULL CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  PRIMARY KEY (org_id, legal_entity_id, financial_year),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES legal_entity (org_id, id)
);

CREATE TABLE fee_refund (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  payment_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'approved', 'rejected', 'paid')),
  requested_by_person_id uuid NOT NULL,
  decided_by_person_id uuid,
  decided_at timestamptz,
  payout_ref text CHECK (length(payout_ref) <= 100),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, payment_id) REFERENCES fee_payment (org_id, id),
  CHECK (decided_by_person_id IS DISTINCT FROM requested_by_person_id),
  CHECK (state <> 'paid' OR payout_ref IS NOT NULL)
);

-- A bounced cheque or a wrong collection: the receipt is reversed, never edited.
CREATE TABLE fee_reversal (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  payment_id uuid NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  charge_paise bigint NOT NULL DEFAULT 0 CHECK (charge_paise >= 0),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'approved', 'rejected')),
  requested_by_person_id uuid NOT NULL,
  decided_by_person_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, payment_id) REFERENCES fee_payment (org_id, id),
  CHECK (decided_by_person_id IS DISTINCT FROM requested_by_person_id)
);
CREATE UNIQUE INDEX fee_reversal_one_open ON fee_reversal (org_id, payment_id) WHERE state <> 'rejected';

-- Append-only. A receipt, a reversal (credit note) or a refund voucher; the snapshot is what was printed.
CREATE TABLE fee_receipt (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  legal_entity_id uuid NOT NULL,
  financial_year text NOT NULL,
  number integer NOT NULL CHECK (number >= 1),
  kind text NOT NULL CHECK (kind IN ('receipt', 'reversal', 'refund')),
  payment_id uuid NOT NULL,
  refund_id uuid,
  student_person_id uuid NOT NULL,
  amount_paise bigint NOT NULL,
  snapshot jsonb NOT NULL,
  issued_by_person_id uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES legal_entity (org_id, id),
  FOREIGN KEY (org_id, payment_id) REFERENCES fee_payment (org_id, id),
  FOREIGN KEY (org_id, refund_id) REFERENCES fee_refund (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, legal_entity_id, financial_year, number),
  CHECK ((kind = 'receipt') = (amount_paise > 0)),
  CHECK ((kind = 'refund') = (refund_id IS NOT NULL))
);
-- One receipt and at most one reversal per payment, however often a webhook arrives.
CREATE UNIQUE INDEX fee_receipt_one_per_payment ON fee_receipt (org_id, payment_id, kind) WHERE kind <> 'refund';

CREATE TABLE fee_day_close (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  cashier_person_id uuid NOT NULL,
  on_date date NOT NULL,
  expected_cash_paise bigint NOT NULL,
  counted_cash_paise bigint NOT NULL CHECK (counted_cash_paise >= 0),
  cheques integer NOT NULL DEFAULT 0,
  cheque_paise bigint NOT NULL DEFAULT 0,
  deposit_ref text CHECK (length(deposit_ref) <= 100),
  note text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, cashier_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, cashier_person_id, on_date),
  CHECK (counted_cash_paise = expected_cash_paise OR note IS NOT NULL)
);

-- ops: gateway webhooks arrive before we know the tenant. Ids and codes only.
CREATE TABLE ops.payment_ref (
  gateway text NOT NULL,
  reference text NOT NULL,
  org_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gateway, reference)
);
CREATE TABLE ops.webhook_event (
  gateway text NOT NULL,
  event_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('processing', 'applied', 'duplicate', 'unmatched', 'ignored')),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gateway, event_id)
);
GRANT SELECT, INSERT ON ops.payment_ref TO cv_app;
GRANT SELECT, INSERT, UPDATE ON ops.webhook_event TO cv_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_head', 'fee_plan', 'fee_plan_line', 'fee_instalment', 'fee_invoice',
    'fee_invoice_line', 'fee_concession', 'fee_payment', 'fee_allocation', 'fee_receipt_counter',
    'fee_refund', 'fee_reversal', 'fee_receipt', 'fee_day_close'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON fee_head, fee_plan, fee_invoice, fee_concession, fee_payment,
  fee_receipt_counter, fee_refund, fee_reversal TO cv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fee_plan_line, fee_instalment TO cv_app;
GRANT SELECT, INSERT ON fee_invoice_line, fee_allocation, fee_receipt, fee_day_close TO cv_app;
-- A published plan's amounts and instalments are fixed; only drafts can be edited.
CREATE POLICY drafts_only ON fee_plan_line AS RESTRICTIVE FOR DELETE
  USING (EXISTS (SELECT 1 FROM fee_plan p WHERE p.org_id = fee_plan_line.org_id AND p.id = fee_plan_line.plan_id AND p.state = 'draft'));
CREATE POLICY drafts_only ON fee_instalment AS RESTRICTIVE FOR DELETE
  USING (EXISTS (SELECT 1 FROM fee_plan p WHERE p.org_id = fee_instalment.org_id AND p.id = fee_instalment.plan_id AND p.state = 'draft'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_invoice_line', 'fee_allocation', 'fee_receipt', 'fee_day_close'] LOOP
    EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_change()', t);
    EXECUTE format('CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_change()', t);
  END LOOP;
END $$;

-- New permissions for each school's copy of the role templates (also in SCHOOL_ROLES).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission
FROM role r
CROSS JOIN (VALUES ('finance.plan.manage'), ('finance.invoice.read'), ('finance.invoice.issue'),
  ('finance.payment.collect'), ('finance.concession.request'), ('finance.concession.approve'),
  ('finance.refund.request'), ('finance.refund.approve'), ('finance.reversal.request'),
  ('finance.reversal.approve'), ('finance.day.close'), ('finance.payment.reconcile')) AS p (permission)
WHERE r.key IN ('school_admin', 'principal')
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission
FROM role r
CROSS JOIN (VALUES ('finance.invoice.read'), ('finance.payment.collect'), ('finance.concession.request'),
  ('finance.refund.request'), ('finance.reversal.request'), ('finance.day.close'), ('finance.payment.reconcile')) AS p (permission)
WHERE r.key = 'office'
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission, relation, guardian_flag)
SELECT r.org_id, r.id, 'finance.payment.pay', 'guardian', 'is_fee_payer' FROM role r WHERE r.key = 'parent'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
