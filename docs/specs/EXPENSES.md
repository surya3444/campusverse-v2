# Expenses and purchases: spec

Status: **step 1 built** (10 November 2026); step 2 when schools ask. Written from the platform map (Finance → Expenses and purchases, build order item 5) and what school offices keep on paper today: a bill file, a voucher book signed by the correspondent, and a budget sheet nobody updates. Anything marked _Default_ stands unless the owner changes it; the owner asked for fewer questions, so every open point has one.

## Job

The office records a bill in a minute, with a photo of it. Someone else approves it, seeing at once what the category has spent against its budget. The accountant pays it and the voucher number comes out without gaps, per legal entity and financial year, like fee receipts. The owner sees spending by category against budget, for every school, without asking anyone.

## Module

**`modules/shared/expenses`**, shared because colleges and universities spend the same way.

- Places, legal entities and financial years come from platform/organisation (`institutionInfo`); a financial year runs April to March.
- Bill photos and PDFs go through platform/documents (`storeFile` under `expenses.bill.record`, served with `cleanFileBytes` under `expenses.bill.read`).
- The module never reads fee tables; fee money stays in finance.

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table                     | Holds                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expense_category`        | Organisation-wide: name (unique), active                                                                                                                                                                                  |
| `expense_vendor`          | Organisation-wide: name, mobile, email, GSTIN, address, active                                                                                                                                                            |
| `expense_budget`          | Per institution, category and financial year: the amount (paise)                                                                                                                                                          |
| `expense_bill`            | Institution, legal entity, financial year (from the bill date), category, vendor or payee, bill number and date, description, amount and the GST in it (paise), file, state, who recorded, who decided and when, the note |
| `expense_payment`         | One per bill, append-only: voucher number, legal entity, financial year, mode, reference, paid on, amount, paid by                                                                                                        |
| `expense_voucher_counter` | The next voucher number per legal entity and financial year                                                                                                                                                               |

**Rules the database enforces:** the person who decides a bill isn't the person who recorded it; a rejection has a note; a decided bill has its decider; the same vendor's bill number can't be recorded twice (unless the first was cancelled); GST is never more than the amount; money is whole paise above zero; payments are never edited or deleted (trigger); voucher numbers are unique per legal entity and financial year.

**Permissions** (SCHOOL_ROLES, migration, access catalogue, area `expenses`):

- `expenses.bill.read`: owner, school admin, principal, office.
- `expenses.bill.record`: the same roles. Record a bill, add a vendor, cancel a bill they recorded while it waits.
- `expenses.bill.approve`: owner, school admin, principal. **Sensitive**: granting it waits for a second owner.
- `expenses.bill.pay`: owner, school admin, office.
- `expenses.setup.manage`: owner, school admin, principal. Categories and budgets.

**Events:** `expenses.bill.recorded.v1`, `expenses.bill.decided.v1`, `expenses.bill.paid.v1`.

## Decisions (_Default_, 10 November 2026)

1. **Categories** are shared by the whole organisation, so the owner compares schools like for like. New organisations start with: Electricity and water, Repairs and maintenance, Stationery and printing, Fuel and vehicle upkeep, Events and functions, Cleaning and housekeeping, Internet and phone, Rent, Teaching materials, Other. A category in use is switched off, never deleted.
2. **Vendors** are shared by the organisation. GSTIN is checked for shape. A bill can also go to a payee without a vendor record (a plumber paid once), by name.
3. **Recording a bill:** category, vendor or payee, bill number (optional for small cash bills), bill date (not in the future), what it was for, amount, GST in it (optional), and a photo or PDF. The financial year follows the bill date.
4. **Approval:**
   - Every bill is approved by someone other than the person who recorded it. Approving or rejecting is one step; a rejection needs a note the recorder sees.
   - The approver sees the category's budget for that school and year, what's already committed (approved and paid bills) and what's left after this bill.
   - Going over budget is allowed and flagged, because a broken pump can't wait for a budget meeting.
   - The recorder can cancel a bill while it waits.
5. **Paying:**
   - Only approved bills, in full. Mode is cash, bank transfer, cheque, UPI or card; anything but cash needs a reference (UTR, cheque number).
   - Paid on can't be before the bill date or in the future.
   - The voucher number is `PV/2026-27/000001`, per legal entity and financial year (of the payment date), with no gaps: the counter is locked until the payment commits.
   - A payment is never edited. A wrong payment is corrected with a reversal voucher in step 2; until then RISKS.md carries it.
6. **Cash:** expenses are paid from petty cash or the bank, not the fee counter, so a cashier's day close is unchanged.
7. **Budgets** are optional: per school, category and financial year. The budget view shows budget, committed, paid and left; categories over budget are flagged.

## Screens

| Screen         | Behaviour                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Expenses (web) | Key figures (spent this year, waiting for approval, to pay, categories over budget). **Bills**: filter by state, **Record bill** (modal with the photo), and on each bill Approve, Reject, Pay, Cancel |
| Bill           | Opens in a side panel: the details, the photo, the budget position, who recorded and decided, the voucher                                                                                              |
| Budgets        | Financial year; each category's budget, committed, paid and left; **Set budget** (modal)                                                                                                               |
| Vendors        | Search; **Add vendor** and edit (modal); switch off                                                                                                                                                    |
| Categories     | Add, rename, switch off                                                                                                                                                                                |

## Steps

1. Categories, vendors, budgets, bills with photos, approval by someone else with the budget position, payment with gapless vouchers, figures, Verse AI `expenses.summary` (amounts by category, no names), tests (allowed and refused, end to end).
2. Purchase requests and orders with goods received, part payments, TDS with vendor PAN (sealed) and bank details, reversal vouchers, printed vouchers for signature, approval limits by amount, messages to approvers, Tally export of vouchers.
