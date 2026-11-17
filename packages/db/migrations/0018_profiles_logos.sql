-- Milestone 19 (docs/specs/INSTITUTION_DEPTH.md): logos, photos and contact details for the
-- organisation, campuses, institutions and people; a campus location for staff check-in.
-- Files live in stored_file (scanned before anyone can read them); these are references.

ALTER TABLE organisation
  ADD COLUMN logo_file_id uuid,
  ADD COLUMN brand_colour text CHECK (brand_colour ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN phone text CHECK (phone ~ '^\+91[0-9]{10}$'),
  ADD COLUMN email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD COLUMN website text CHECK (website IS NULL OR website ~ '^https?://');

ALTER TABLE legal_entity
  ADD COLUMN registered_address text CHECK (registered_address IS NULL OR length(registered_address) <= 300);

ALTER TABLE campus
  ADD COLUMN photo_file_id uuid,
  ADD COLUMN phone text CHECK (phone ~ '^\+91[0-9]{10}$'),
  ADD COLUMN email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Where the gate is: staff check-ins are compared with this (200 m by default).
  ADD COLUMN latitude numeric(9, 6) CHECK (latitude BETWEEN -90 AND 90),
  ADD COLUMN longitude numeric(9, 6) CHECK (longitude BETWEEN -180 AND 180),
  ADD COLUMN geofence_metres integer NOT NULL DEFAULT 200 CHECK (geofence_metres BETWEEN 50 AND 2000),
  ADD CHECK ((latitude IS NULL) = (longitude IS NULL));

ALTER TABLE institution
  ADD COLUMN logo_file_id uuid,
  -- The principal's signature, printed on certificates. Readable only by those who manage setup.
  ADD COLUMN signature_file_id uuid;

ALTER TABLE person
  ADD COLUMN photo_file_id uuid,
  ADD COLUMN email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD COLUMN preferred_language text NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en', 'kn', 'te', 'ta', 'hi', 'mr', 'ur'));

ALTER TABLE organisation ADD FOREIGN KEY (id, logo_file_id) REFERENCES stored_file (org_id, id);
ALTER TABLE campus ADD FOREIGN KEY (org_id, photo_file_id) REFERENCES stored_file (org_id, id);
ALTER TABLE institution ADD FOREIGN KEY (org_id, logo_file_id) REFERENCES stored_file (org_id, id);
ALTER TABLE institution ADD FOREIGN KEY (org_id, signature_file_id) REFERENCES stored_file (org_id, id);
ALTER TABLE person ADD FOREIGN KEY (org_id, photo_file_id) REFERENCES stored_file (org_id, id);

-- Everyone may change their own photo, email and language: a 'self' grant on every role, so it
-- only ever applies to the holder's own record.
INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'people.profile.update_own', 'self' FROM role r
ON CONFLICT DO NOTHING;

-- Editing the organisation and its campuses, and adding campuses and institutions: owners.
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'platform.organisation.manage' FROM role r WHERE r.key = 'owner'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
