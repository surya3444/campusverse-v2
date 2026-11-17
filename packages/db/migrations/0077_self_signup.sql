-- Self-serve sign-up (rule book §11: "Self-serve onboarding; 4-week school go-live"). Anyone can
-- start: a sign-up opens an invite on the Pilot plan with no staff member behind it, and the
-- person builds their organisation in onboarding after confirming their mobile with a code.
-- Owned by platform/control.

ALTER TABLE control.account_invite ALTER COLUMN invited_by DROP NOT NULL;
ALTER TABLE control.account_invite
  ADD COLUMN source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'self'));
ALTER TABLE control.account_invite
  ADD CONSTRAINT account_invite_inviter CHECK ((source = 'staff') = (invited_by IS NOT NULL));
