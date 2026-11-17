-- Connected school, step 1 (docs/specs/CONNECTED_SCHOOL.md): a route's usual driver and attendant,
-- picked from the school's staff when the route is set up. Suggestions for the trip, not access.
ALTER TABLE transport_route
  ADD COLUMN driver_person_id uuid,
  ADD COLUMN attendant_person_id uuid,
  ADD CONSTRAINT transport_route_driver_fk FOREIGN KEY (org_id, driver_person_id)
    REFERENCES person (org_id, id),
  ADD CONSTRAINT transport_route_attendant_fk FOREIGN KEY (org_id, attendant_person_id)
    REFERENCES person (org_id, id),
  ADD CONSTRAINT transport_route_crew_differs CHECK (driver_person_id IS DISTINCT FROM attendant_person_id
    OR driver_person_id IS NULL);
CREATE INDEX transport_route_driver_idx ON transport_route (org_id, driver_person_id) WHERE driver_person_id IS NOT NULL;
CREATE INDEX transport_route_attendant_idx ON transport_route (org_id, attendant_person_id) WHERE attendant_person_id IS NOT NULL;
