# platform/identity

Global login: one account can act as several people across organisations, or several people on one shared family phone.

- **Phone OTP** (parents): six-digit code, 5 minutes, 5 attempts, single use. Sends are limited to 3 per phone and 20 per IP every 15 minutes, and counted even for unregistered numbers. Codes go only to registered numbers, with the same answer either way. Codes, phones and IPs are stored in Redis only as keyed hashes (`AUTH_PEPPER`). If Redis is down, nothing is sent or accepted.
- **Google** (staff): ID token verified against Google's keys, issuer and `GOOGLE_CLIENT_ID`. Only invited staff get in: either their Google id is already linked, or their verified email matches an invited email, and then it is linked.
- **Sessions:** opaque 256-bit tokens, stored as SHA-256 hashes. Access tokens last 15 minutes, refresh tokens 30 days, and refresh rotates. Replaying an old refresh token revokes the whole family. Revoking a device ends all its sessions. A locked account loses access at once.
- **Two-step sign-in** (`application/mfa.ts`, rule book §12.4 decision 10): an authenticator app (RFC 6238, `domain/totp.ts`, checked against the RFC test vectors). `startMfaSetup` makes a secret sealed with keys derived for `identity-mfa` and returns the `otpauth://` URI; it is switched on only by `confirmMfa` with a working code. When on, phone and Google sign-in return `{ mfa: { challenge } }` instead of tokens (`sessionOrChallenge`); `completeMfa` starts the session after a code: five minutes, five tries, used once, and a code's time step is never accepted twice. `disableMfa` needs a current code. The web keeps the challenge in an httpOnly cookie (`/session/verify` → `/session/mfa`).
- **Actors:** `resolveActor()` accepts the client's chosen org and person only if the login is linked to that person.

**Owned tables:** `identity.account`, `identity.login_identifier`, `identity.account_person_link`, `identity.trusted_device`, `identity.session` (migration 0002); `identity.mfa_secret`, `identity.mfa_challenge` (migration 0083). These are global by design and allowlisted by the RLS suite.

**Not yet:** requiring two-step sign-in for sensitive roles (it is each person's choice today), recovery codes, Microsoft sign-in, and real SMS or WhatsApp senders (Milestone 5). HTTP endpoints arrive with `apps/api`; they must check who may revoke which session.

**Events:** none yet. `user invited` arrives with the outbox in Milestone 5.
