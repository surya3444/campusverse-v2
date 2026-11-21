-- Organisation admins and their views (owner's brief, 20 Nov 2026; rule book §11 self-serve
-- onboarding, §12.4 hierarchy, §10.3 access).
--
-- platform/control: a self sign-up is now a request ('requested') that Campusverse staff approve
-- ('invited', onboarding opens) or decline ('declined', with a reason). Staff can also invite an
-- email address with a one-time link ('email'): following the link proves the address, so it needs
-- no approval; phone and account arrive when the person signs up through it. An admin who has
-- onboarded can start another organisation of their own ('additional'), each its own tenant.
--
-- platform/organisation: view_preference, the part of the organisation a person chooses to look
-- at (the whole organisation, some campuses, or some institutions). It narrows what screens show;
-- it never widens access, which roles and scopes still decide on every read.

ALTER TABLE control.account_invite ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE control.account_invite ALTER COLUMN account_id DROP NOT NULL;

ALTER TABLE control.account_invite DROP CONSTRAINT account_invite_status_check;
ALTER TABLE control.account_invite ADD CONSTRAINT account_invite_status_check
  CHECK (status IN ('requested', 'invited', 'active', 'declined', 'cancelled'));

ALTER TABLE control.account_invite DROP CONSTRAINT account_invite_source_check;
ALTER TABLE control.account_invite ADD CONSTRAINT account_invite_source_check
  CHECK (source IN ('staff', 'self', 'email', 'additional'));

ALTER TABLE control.account_invite DROP CONSTRAINT account_invite_inviter;
ALTER TABLE control.account_invite ADD CONSTRAINT account_invite_inviter
  CHECK ((source IN ('staff', 'email')) = (invited_by IS NOT NULL));

ALTER TABLE control.account_invite
  ADD COLUMN token_hash bytea UNIQUE,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN decided_by uuid REFERENCES control.staff (id),
  ADD COLUMN decided_at timestamptz,
  ADD COLUMN decline_reason text CHECK (decline_reason IS NULL OR length(btrim(decline_reason)) BETWEEN 3 AND 500);

-- Only an email invite nobody has taken up yet may lack the login.
ALTER TABLE control.account_invite ADD CONSTRAINT account_invite_login CHECK (
  (account_id IS NOT NULL AND phone IS NOT NULL)
  OR (source = 'email' AND status IN ('invited', 'cancelled') AND account_id IS NULL AND phone IS NULL)
);
ALTER TABLE control.account_invite ADD CONSTRAINT account_invite_email_link CHECK (
  (source = 'email') = (token_hash IS NOT NULL AND expires_at IS NOT NULL AND email IS NOT NULL)
);
ALTER TABLE control.account_invite ADD CONSTRAINT account_invite_declined CHECK (
  (status = 'declined') = (decline_reason IS NOT NULL)
);

-- One open request or invite per mobile, and one untaken link per email.
DROP INDEX control.account_invite_open_phone;
CREATE UNIQUE INDEX account_invite_open_phone ON control.account_invite (phone)
  WHERE status IN ('requested', 'invited');
CREATE UNIQUE INDEX account_invite_open_email ON control.account_invite (email)
  WHERE source = 'email' AND status = 'invited' AND account_id IS NULL;

-- The saved view: one row per person. level 'organisation' has no ids; the others list campuses
-- or institutions of this organisation (checked against the person's reach when saved and read).
CREATE TABLE view_preference (
  org_id uuid NOT NULL REFERENCES organisation (id),
  person_id uuid NOT NULL,
  level text NOT NULL CHECK (level IN ('organisation', 'campus', 'institution')),
  node_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, person_id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  CHECK ((level = 'organisation') = (cardinality(node_ids) = 0)),
  CHECK (cardinality(node_ids) <= 200)
);

ALTER TABLE view_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE view_preference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON view_preference USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON view_preference TO cv_app;
