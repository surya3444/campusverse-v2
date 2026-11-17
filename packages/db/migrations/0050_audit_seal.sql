-- Activity Log, tamper-evident (rule book §13.12, P0 item 10). Owned by platform/audit.
-- audit_event is already append-only. A seal is a SHA-256 hash chain over the events in id order,
-- so a row changed or removed behind the app's back (by a database superuser, say) breaks every
-- seal after it. Seals are append-only too.

CREATE TABLE audit_seal (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  upto_event_id uuid NOT NULL,
  event_count integer NOT NULL CHECK (event_count > 0),
  chain_sha256 text NOT NULL CHECK (chain_sha256 ~ '^[0-9a-f]{64}$'),
  sealed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, upto_event_id),
  FOREIGN KEY (org_id, upto_event_id) REFERENCES audit_event (org_id, id)
);

ALTER TABLE audit_seal ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_seal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_seal USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());

CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON audit_seal
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON audit_seal
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

GRANT SELECT, INSERT ON audit_seal TO cv_app;
