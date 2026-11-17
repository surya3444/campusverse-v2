-- Milestone 18, step 2 (docs/specs/TRANSPORT.md): riders on routes, dated like enrolment, and
-- fare zones as fee and notice audiences.

-- A zone per campus and number, so fee plans can name it by id. Stops keep their number.
CREATE TABLE transport_fare_zone (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  campus_id uuid NOT NULL,
  number integer NOT NULL CHECK (number BETWEEN 1 AND 20),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, campus_id) REFERENCES campus (org_id, id),
  UNIQUE (org_id, campus_id, number)
);
INSERT INTO transport_fare_zone (org_id, campus_id, number)
SELECT DISTINCT org_id, campus_id, fare_zone FROM transport_stop WHERE fare_zone IS NOT NULL
ON CONFLICT DO NOTHING;

-- Lets an assignment carry its route's direction, so one rule covers "one pickup route at a time".
ALTER TABLE transport_route ADD CONSTRAINT transport_route_direction_key UNIQUE (org_id, id, direction);

-- Who rides which route from which stop, and when. A change is a new row; history stays.
CREATE TABLE transport_assignment (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  route_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('pickup', 'drop')),
  stop_id uuid NOT NULL,
  valid_during daterange NOT NULL CHECK (isempty(valid_during) OR NOT lower_inf(valid_during)),
  import_batch_id uuid,
  created_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, route_id, direction) REFERENCES transport_route (org_id, id, direction),
  -- The stop must be on the route. Deferred: saving a route replaces its stops in one transaction.
  FOREIGN KEY (org_id, route_id, stop_id) REFERENCES transport_route_stop (org_id, route_id, stop_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id),
  EXCLUDE USING gist (org_id WITH =, person_id WITH =, direction WITH =, valid_during WITH &&)
);
CREATE INDEX transport_assignment_route_idx ON transport_assignment (org_id, route_id);
CREATE INDEX transport_assignment_person_idx ON transport_assignment (org_id, person_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transport_fare_zone', 'transport_assignment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON transport_fare_zone TO cv_app;
-- Assignments are ended (valid_during shortened) or, before they start, emptied; never deleted.
GRANT SELECT, INSERT, UPDATE ON transport_assignment TO cv_app;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'transport.assignment.manage' FROM role r
WHERE r.key IN ('owner', 'school_admin', 'principal', 'office')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
