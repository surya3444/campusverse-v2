-- Milestone 18, step 5 (docs/specs/TRANSPORT.md): parents see their own child's bus and can say
-- "not taking the bus today". The attendant sees it on the stop's list.

CREATE TABLE transport_skip (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  trip_date date NOT NULL,
  direction text NOT NULL CHECK (direction IN ('pickup', 'drop')),
  requested_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Undone by the parent; the row stays as the record.
  cancelled_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, requested_by_person_id) REFERENCES person (org_id, id)
);
CREATE UNIQUE INDEX transport_skip_once ON transport_skip (org_id, person_id, trip_date, direction)
  WHERE cancelled_at IS NULL;

ALTER TABLE transport_skip ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_skip FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transport_skip USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON transport_skip TO cv_app;

-- Parents: their own child's bus (guardian relation), and telling the school they won't ride.
INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, p.permission, 'guardian' FROM role r
CROSS JOIN (VALUES ('transport.trip.read'), ('transport.ride.skip')) AS p (permission)
WHERE r.key = 'parent'
ON CONFLICT DO NOTHING;

-- The owner holds every catalogue permission (decision 0020).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'transport.ride.skip' FROM role r WHERE r.key = 'owner'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
