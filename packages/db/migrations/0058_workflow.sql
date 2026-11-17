-- Campus Core › Workflow & Approvals (rule book §12.4 decision 6, §13 Campus Core, P0 item 11):
-- one engine for every module's approvals. Steps by role and scope, amount limits, timers and
-- escalation; a request snapshots the steps that apply when it starts. Owning modules keep their
-- own state and ask the engine who may decide. Owned by platform/workflow.

-- The designer's steps for a process, organisation-wide (institution_id null) or for one
-- institution, which then replaces the organisation's steps there.
CREATE TABLE approval_step (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  process text NOT NULL CHECK (process ~ '^[a-z]+(\.[a-z_]+)+$'),
  institution_id uuid,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
  approver_role_key text NOT NULL,
  -- The step applies only from this amount up; null applies always.
  min_amount_paise bigint CHECK (min_amount_paise >= 0),
  -- After this long the escalation role may decide too.
  hours integer CHECK (hours BETWEEN 1 AND 720),
  escalate_role_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE NULLS NOT DISTINCT (org_id, process, institution_id, position),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, approver_role_key) REFERENCES role (org_id, key),
  FOREIGN KEY (org_id, escalate_role_key) REFERENCES role (org_id, key),
  CHECK ((hours IS NULL) = (escalate_role_key IS NULL))
);

CREATE TABLE approval_request (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  process text NOT NULL,
  subject_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  campus_id uuid NOT NULL,
  amount_paise bigint CHECK (amount_paise >= 0),
  -- What the approver sees in My Work, written by the owning module.
  summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 200),
  requested_by_person_id uuid,
  -- The steps that applied at the start: [{role, hours, escalateTo}]; role null = anyone holding
  -- the process's permission at the institution.
  steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 6),
  step_index smallint NOT NULL DEFAULT 0 CHECK (step_index >= 0),
  step_since timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, requested_by_person_id) REFERENCES person (org_id, id),
  CHECK ((status = 'pending') = (closed_at IS NULL))
);
-- One open request per subject and process.
CREATE UNIQUE INDEX approval_request_open_idx ON approval_request (org_id, process, subject_id)
  WHERE status = 'pending';
CREATE INDEX approval_request_pending_idx ON approval_request (org_id, status, created_at);

-- Every decision, append-only.
CREATE TABLE approval_decision (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  request_id uuid NOT NULL,
  step_index smallint NOT NULL,
  decided_by_person_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve', 'reject')),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
  escalated boolean NOT NULL DEFAULT false,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, request_id, step_index),
  FOREIGN KEY (org_id, request_id) REFERENCES approval_request (org_id, id),
  FOREIGN KEY (org_id, decided_by_person_id) REFERENCES person (org_id, id),
  CHECK (decision = 'approve' OR note IS NOT NULL)
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON approval_decision
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['approval_step', 'approval_request', 'approval_decision'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

-- The designer replaces a process's steps as a whole.
GRANT SELECT, INSERT, UPDATE, DELETE ON approval_step TO cv_app;
GRANT SELECT, INSERT, UPDATE ON approval_request TO cv_app;
GRANT SELECT, INSERT ON approval_decision TO cv_app;

-- Who may change approval steps: owners (sensitive: changing who approves money).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'platform.workflow.manage' FROM role r WHERE r.key = 'owner'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
