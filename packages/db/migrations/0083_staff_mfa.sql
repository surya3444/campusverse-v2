-- Two-step sign-in for staff with an authenticator app (rule book §12.4 decision 10 "MFA for
-- staff", §9.8 security, P0). Global login tables like the rest of identity (allowlisted by the
-- RLS suite). The secret is sealed with keys derived for this purpose; only a hash of each
-- sign-in challenge is kept, and a code's time step is never accepted twice.

CREATE TABLE identity.mfa_secret (
  account_id uuid PRIMARY KEY REFERENCES identity.account (id),
  secret bytea NOT NULL,
  -- Null until the person types a first code from their app; only then is it asked at sign-in.
  enabled_at timestamptz,
  last_step bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A sign-in that passed its first step and waits for the authenticator code. Five minutes,
-- five tries, used once.
CREATE TABLE identity.mfa_challenge (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES identity.account (id),
  device_id uuid NOT NULL REFERENCES identity.trusted_device (id),
  expires_at timestamptz NOT NULL,
  tries integer NOT NULL DEFAULT 0 CHECK (tries BETWEEN 0 AND 5),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_challenge_account_idx ON identity.mfa_challenge (account_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON identity.mfa_secret TO cv_app;
GRANT SELECT, INSERT, UPDATE ON identity.mfa_challenge TO cv_app;
