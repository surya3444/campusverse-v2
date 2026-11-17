-- Onboarding: the super admin invites an organisation admin (a login with no organisation yet);
-- the admin signs in and builds the organisation, campuses and institutions themselves.
-- Campuses and institutions gain the profile a school is asked for.

CREATE TABLE control.account_invite (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  phone text NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  plan_code text NOT NULL REFERENCES control.plan (code),
  account_id uuid NOT NULL,
  invited_by uuid NOT NULL REFERENCES control.staff (id),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'cancelled')),
  -- The admin's answers so far (their own profile and their institutions' profiles; no student data).
  draft jsonb NOT NULL DEFAULT '{}',
  org_id uuid REFERENCES organisation (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'active') = (org_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX account_invite_open_phone ON control.account_invite (phone) WHERE status = 'invited';
CREATE INDEX account_invite_account ON control.account_invite (account_id);
GRANT SELECT, INSERT, UPDATE ON control.account_invite TO cv_app;

ALTER TABLE campus
  ADD COLUMN address_line text CHECK (address_line IS NULL OR length(address_line) <= 300),
  ADD COLUMN city text CHECK (city IS NULL OR length(city) <= 100),
  ADD COLUMN district text CHECK (district IS NULL OR length(district) <= 100),
  ADD COLUMN state_code text CHECK (state_code ~ '^[A-Z]{2}$'),
  ADD COLUMN pincode text CHECK (pincode ~ '^[1-9][0-9]{5}$');

ALTER TABLE institution
  ADD COLUMN udise_code text CHECK (udise_code ~ '^[0-9]{11}$'),
  ADD COLUMN affiliation_number text CHECK (affiliation_number IS NULL OR length(affiliation_number) <= 40),
  ADD COLUMN established_year integer CHECK (established_year BETWEEN 1800 AND 2100),
  ADD COLUMN medium text CHECK (medium IS NULL OR length(medium) <= 40),
  ADD COLUMN lowest_class text CHECK (lowest_class IS NULL OR length(lowest_class) <= 10),
  ADD COLUMN highest_class text CHECK (highest_class IS NULL OR length(highest_class) <= 10),
  ADD COLUMN address_line text CHECK (address_line IS NULL OR length(address_line) <= 300),
  ADD COLUMN city text CHECK (city IS NULL OR length(city) <= 100),
  ADD COLUMN district text CHECK (district IS NULL OR length(district) <= 100),
  ADD COLUMN pincode text CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  ADD COLUMN phone text CHECK (phone ~ '^\+91[0-9]{10}$'),
  ADD COLUMN email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD COLUMN website text CHECK (website IS NULL OR website ~ '^https?://');
