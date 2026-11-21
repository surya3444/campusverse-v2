# Super admin (Milestone 14)

Status: draft, 5 November 2026. Written from the build guide (Milestone 14, tenancy rules, authentication, privacy) because the Admin Portal plan document is not in this repository. Open questions at the end carry the defaults that were built.

**Exit check:** Campus Verse staff can run a customer without SQL: sign up a school, put it on a plan, switch features, look into a problem with the school's knowledge, see whether messages are being delivered, pause something in an emergency, and suspend or reactivate the customer, with every step in an audit trail.

## Who uses it

Campus Verse staff only. Schools never see this portal. Two staff roles:

| Role    | Can                                                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------- |
| Owner   | Everything below, including staff, plans, switches, and approving others' requests                                         |
| Support | Read customers, delivery health and the audit trail; request support access; create customers; change flags for a customer |

## Sign-in

- Passkeys only (WebAuthn, user verification required). No passwords, no OTP. SSO comes when Campus Verse has a company identity provider.
- A new staff member gets a one-time enrolment link (15 minutes) from an owner in the portal, or from a development CLI for the first owner. The link registers their passkey.
- Sessions: 30 minutes idle, 8 hours at most, httpOnly cookie on the admin app only. Staff can be disabled, which ends their sessions.
- Separate app (`apps/admin`, port 3001) and separate session table: a school login never opens the admin API, and the reverse.

## Tenancy

- Admin data lives in a global schema `control`, allowlisted like `identity` and `ops`. No tenant data is copied there.
- Nothing bypasses RLS. Admin code reaches a customer only through `withTenant(orgId)`, inside an audited service function: every call writes `control.admin_audit`, and anything that touches the customer also writes the customer's own `audit_event`, so the school sees it in its Activity Log.
- Without support access, staff see counts only (institutions, students, staff, messages), never names.

## Screens

| Screen          | What                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customers       | List with status, plan, students against the plan's limit, last activity. New customer: school name, state, board, owner name and phone (replaces the CLI)                                                   |
| Admins          | Sign-up requests to approve, or decline with a reason the person sees; invite by email (a one-time 14-day link, copied or opened in mail); every admin with the organisations they run, and open invitations |
| Customer        | Status, plan, flags, switches for this customer, support access, recent audit, delivery counts                                                                                                               |
| Plans           | Plan code, name, student limit, price per student per year (paise), included features                                                                                                                        |
| Feature flags   | Each flag's default and per-customer overrides                                                                                                                                                               |
| Approvals       | Requests waiting for a second person; approve or reject with a reason                                                                                                                                        |
| Support access  | Active and past grants                                                                                                                                                                                       |
| Audit           | Search by staff, customer, action and date                                                                                                                                                                   |
| Delivery health | Outbox backlog and oldest waiting event; per channel sent, delivered and failed in the last 24 hours, per customer                                                                                           |
| Switches        | Emergency switches, global or per customer                                                                                                                                                                   |
| Staff           | Staff, roles, enrolment links, disable                                                                                                                                                                       |

## Rules

| Action                                  | Rule                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Suspend, close or reactivate a customer | Needs a second person's approval (maker-checker, also a CHECK constraint). Suspended: every school request is refused; data is kept |
| Support access                          | Requested with a reason and ticket, for at most 4 hours, approved by a second person. Read-only. Shows in the school's Activity Log |
| Plan change                             | Immediate, audited. Over the student limit is a warning, never a block                                                              |
| Feature flag                            | Immediate, audited; per customer or default                                                                                         |
| Emergency switch                        | Immediate (no approval: speed matters), owner only, needs a reason, audited. Global or per customer                                 |
| Audit                                   | `control.admin_audit` is append-only                                                                                                |

**Emergency switches:**

| Switch          | Effect                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------- |
| `messaging_off` | The worker stops sending WhatsApp, SMS and push; messages wait and go when it is turned off |
| `payments_off`  | No new online payment links; counter receipts still work                                    |
| `writes_off`    | Read-only: every school write is refused with a clear message                               |

**Feature flags at start:** `online_payments` (on), `verse_ai` (off; Milestone 15).

## Not in this milestone

Billing and invoices to schools, SSO for staff, impersonation ("view as a user"), status page, data export for a leaving customer, delivery provider dashboards.

## Open questions for the owner

1. Support access: read-only summaries (default), or full "view as" a school user?
2. Should emergency switches also need a second person, or stay immediate (default)?
3. Over the plan's student limit: warn only (default), or block new admissions?
4. Is a 4-hour maximum for support access right?
