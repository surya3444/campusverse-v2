-- Audit log, consent ledger, outbox, notifications and documents.

-- Append-only guard: refuses UPDATE, DELETE and TRUNCATE for every role, owner included.
CREATE FUNCTION forbid_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

------------------------------------------------------------------------------------------
-- ops: cross-tenant plumbing read by workers before a tenant is chosen. Ids and codes only.
------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA ops TO cv_app;

-- Written in the same transaction as the business change; a worker relays it to BullMQ.
CREATE TABLE ops.outbox (
  id uuid PRIMARY KEY DEFAULT uuidv7(), -- the event id
  org_id uuid NOT NULL REFERENCES organisation (id),
  type text NOT NULL CHECK (type ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+\.v[0-9]+$'),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON ops.outbox (id) WHERE published_at IS NULL;

-- Tenant code may only emit for its own tenant; the relay reads every tenant.
ALTER TABLE ops.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY emit_own_tenant ON ops.outbox FOR INSERT WITH CHECK (org_id = app_current_org());
CREATE POLICY relay_reads ON ops.outbox FOR SELECT USING (true);
CREATE POLICY relay_marks ON ops.outbox FOR UPDATE USING (true);

-- One row per consumer per event: the reason a repeated event changes nothing.
CREATE TABLE ops.processed_event (
  consumer text NOT NULL,
  event_id uuid NOT NULL,
  org_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- Provider webhooks carry only the provider's reference; this finds the tenant and delivery.
CREATE TABLE ops.delivery_ref (
  provider text NOT NULL,
  provider_ref text NOT NULL,
  org_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  PRIMARY KEY (provider, provider_ref)
);

-- Public QR verification: type, number, date and status. Never any student detail.
CREATE TABLE ops.document_verification (
  code text PRIMARY KEY CHECK (code ~ '^[A-Za-z0-9_-]{16,64}$'),
  org_id uuid NOT NULL,
  document_id uuid NOT NULL,
  kind text NOT NULL,
  number text NOT NULL,
  version integer NOT NULL,
  sha256 text NOT NULL,
  issued_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'superseded', 'cancelled')),
  status_changed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON ops.outbox, ops.delivery_ref, ops.document_verification TO cv_app;
GRANT SELECT, INSERT ON ops.processed_event TO cv_app;

------------------------------------------------------------------------------------------
-- public: tenant tables
------------------------------------------------------------------------------------------

-- detail holds ids and codes, never names, phones or message text.
CREATE TABLE audit_event (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_account_id uuid,
  actor_person_id uuid,
  action text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+$'),
  entity_type text NOT NULL CHECK (entity_type ~ '^[a-z_]+$'),
  entity_id uuid,
  data_class text NOT NULL CHECK (data_class IN ('operational', 'personal', 'sensitive', 'restricted')),
  reason text,
  detail jsonb NOT NULL DEFAULT '{}',
  request_id text,
  PRIMARY KEY (org_id, id)
);
CREATE INDEX audit_event_entity_idx ON audit_event (org_id, entity_type, entity_id);
CREATE INDEX audit_event_time_idx ON audit_event (org_id, occurred_at);
CREATE INDEX audit_event_actor_idx ON audit_event (org_id, actor_person_id, occurred_at);

CREATE TABLE consent_notice (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  purpose text NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_]{1,40}$'),
  version integer NOT NULL CHECK (version > 0),
  language text NOT NULL CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  body text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, purpose, version, language),
  UNIQUE (org_id, id, purpose)
);

-- Ledger: one row per decision. Current consent is the latest row per student, guardian, purpose.
CREATE TABLE consent_record (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  student_person_id uuid NOT NULL,
  guardian_person_id uuid NOT NULL,
  notice_id uuid NOT NULL,
  purpose text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('granted', 'withdrawn')),
  source text NOT NULL CHECK (source IN ('app', 'office', 'paper', 'import')),
  evidence_file_id uuid,
  recorded_by_account_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, guardian_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, notice_id, purpose) REFERENCES consent_notice (org_id, id, purpose)
);
CREATE INDEX consent_record_current_idx
  ON consent_record (org_id, student_person_id, purpose, guardian_person_id, id DESC);

CREATE TABLE person_contact (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('push', 'whatsapp', 'sms')),
  address text NOT NULL CHECK (channel = 'push' OR address ~ '^\+91[6-9][0-9]{9}$'),
  disabled_at timestamptz,
  disabled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, person_id, channel, address),
  CHECK ((disabled_at IS NULL) = (disabled_reason IS NULL))
);

CREATE TABLE notification_message (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  recipient_person_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'urgent', 'absence', 'fee_receipt', 'fee_reminder', 'circular', 'homework', 'notice', 'account'
  )),
  language text NOT NULL CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  title text NOT NULL,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN (
    'draft', 'approved', 'scheduled', 'queued', 'sent', 'delivered', 'read', 'acknowledged',
    'failed', 'fallback_sent', 'cancelled'
  )),
  -- Same key, same message: a repeated request never sends twice.
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, recipient_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, dedupe_key)
);
CREATE INDEX notification_message_recipient_idx
  ON notification_message (org_id, recipient_person_id, created_at);

CREATE TABLE notification_delivery (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  message_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('push', 'whatsapp', 'sms')),
  contact_id uuid NOT NULL,
  attempt_order integer NOT NULL CHECK (attempt_order > 0),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed')),
  provider text,
  provider_ref text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, message_id) REFERENCES notification_message (org_id, id),
  FOREIGN KEY (org_id, contact_id) REFERENCES person_contact (org_id, id),
  UNIQUE (org_id, message_id, channel)
);

CREATE TABLE stored_file (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  purpose text NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_]{1,40}$'),
  file_name text NOT NULL CHECK (btrim(file_name) <> '' AND length(file_name) <= 200),
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  storage_key text NOT NULL UNIQUE,
  scan_status text NOT NULL DEFAULT 'awaiting_upload'
    CHECK (scan_status IN ('awaiting_upload', 'pending', 'clean', 'infected', 'rejected')),
  scan_note text,
  sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_by_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  scanned_at timestamptz,
  PRIMARY KEY (org_id, id)
);

-- Frozen issued documents. A correction is a new version that supersedes the old one.
CREATE TABLE issued_document (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  number text NOT NULL CHECK (btrim(number) <> ''),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  supersedes_id uuid,
  subject_person_id uuid,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL UNIQUE,
  verification_code text NOT NULL UNIQUE,
  issued_by_account_id uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, kind, number, version),
  FOREIGN KEY (org_id, supersedes_id) REFERENCES issued_document (org_id, id),
  FOREIGN KEY (org_id, subject_person_id) REFERENCES person (org_id, id),
  CHECK ((version = 1) = (supersedes_id IS NULL))
);

CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON consent_notice
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON consent_record
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON consent_record
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON issued_document
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON issued_document
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_event
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE consent_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_notice FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consent_notice
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE consent_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_record FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consent_record
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE person_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_contact FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON person_contact
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE notification_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_message FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_message
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE notification_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_delivery
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE stored_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE stored_file FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stored_file
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

ALTER TABLE issued_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE issued_document FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issued_document
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

GRANT SELECT, INSERT ON audit_event, consent_notice, consent_record, issued_document TO cv_app;
GRANT SELECT, INSERT, UPDATE
  ON person_contact, notification_message, notification_delivery, stored_file TO cv_app;
