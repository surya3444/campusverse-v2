# Payroll: spec

Status: **step 1 building** (13 November 2026). From the platform map (People → Payroll) and the owner's request for staff "from salaries to their issues". Anything marked _Default_ stands unless the owner changes it.

## Job

Each month the office prepares the payroll from each staff member's salary and the month's attendance and leave (loss of pay comes from staff attendance's `payrollInputs`). They check it, a second person approves it, and it's marked paid. Every staff member sees their own payslips. Salaries are private: only the person and people who run payroll ever see them.

## Module

**`modules/people/payroll`**: people, not academics; any institution pays staff. Staff and loss-of-pay days come from shared/staff-attendance (`payrollInputs`), names from people/records, statutory rates from `packages/rules` (`payrollRules(stateCode)`).

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table            | Holds                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payroll_salary` | Person, institution, effective from, monthly basic, DA, HRA, conveyance, special and other allowances (paise), PF / ESI / PT applicable, monthly TDS, other deduction, set by. Dated: a change is a new row |
| `payroll_run`    | Institution, month (first day), state (`draft`, `approved`, `paid`), prepared by, approved by, paid on, payment mode and reference, totals                                                                  |
| `payroll_slip`   | Run, person, snapshot (name, employee code, designation), calendar days, loss of pay in half days, each earning, gross, PF, ESI, PT, TDS, other deduction, net, employer PF and ESI                         |

**Rules the database enforces:** amounts are whole paise and never negative; one salary per person per effective date; one run per institution per month; one slip per person per run; the approver isn't the preparer; a paid run has a paid date; net = gross − every deduction.

**Permissions** (SCHOOL_ROLES, migration, access catalogue, area `people`):

- `payroll.salary.manage`: owner, school admin. Set and change salaries, see every salary. **Sensitive.**
- `payroll.run.prepare`: owner, school admin, office. Prepare and recompute a draft month, see its slips, mark an approved run paid.
- `payroll.run.approve`: owner, school admin, principal. Approve a draft prepared by someone else. **Sensitive.**
- `payroll.slip.self`: every staff role, relation `self`: their own salary and payslips.

**Events:** `payroll.run.approved.v1`, `payroll.run.paid.v1` (each staff member is told their payslip is ready).

## Calculation (domain, whole paise)

- **Paid days** = calendar days − loss of pay (half days count as half). Every earning is prorated by paid days ÷ calendar days, rounded half up to the rupee.
- **PF** (when applicable): 12% of prorated basic + DA, on wages up to ₹15,000 (the statutory ceiling), employee and employer alike. _Default:_ capped at the ceiling.
- **ESI** (when applicable and the full monthly gross is ₹21,000 or less): employee 0.75% and employer 3.25% of the month's gross, rounded up to the rupee.
- **Professional tax** (when applicable): the state's monthly slab on the month's gross, from the rule pack (Karnataka, Telangana, Andhra Pradesh, Tamil Nadu; all `verified: false` until checked against the state order). Tamil Nadu levies half-yearly; _Default:_ one sixth each month.
- **TDS**: the monthly amount the accountant sets on the salary (no tax computation in step 1).
- Deductions never take net below zero: TDS, then other deduction, are reduced first, and the slip says so.

## Decisions (_Default_, 13 November 2026)

1. A run takes everyone on staff during the month who has a salary effective on or before the month's last day. Staff without a salary are listed as "no salary set" in the preview and skipped.
2. **Preview then commit:** preparing shows every slip before anything is saved. Recomputing a draft replaces its slips. An approved run never changes; a mistake is corrected next month (an adjustment line comes in step 2).
3. Attendance days not yet marked count as worked (staff attendance's rule). A month can be prepared before it ends; the preview says "attendance up to <date>".
4. Payment is recorded, not made: mode (bank transfer, cash, cheque) and a reference. The bank file is a CSV of name, employee code, net and the account's last four digits, downloaded and logged.
5. Verse AI sees only the month's totals and counts, never anyone's salary.

## Screens

| Screen        | Behaviour                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payroll (web) | **Runs**: months with state and totals; **Prepare month** (preview canvas: who, paid days, gross, deductions, net; who has no salary); open a run: slips, approve, mark paid, bank CSV |
| Salaries      | Every staff member with their current monthly gross and net; **Set salary** (modal: earnings, PF / ESI / PT, TDS, other deduction, effective from) with the history                    |
| My payslips   | The signed-in person's own payslips (any staff role), each opening a printable slip                                                                                                    |
| Staff record  | The Salary card: current gross and net, last payslip                                                                                                                                   |

## Steps

1. Salaries, monthly runs with loss of pay, PF / ESI / PT / TDS, approval by a second person, marking paid, own payslips, bank CSV, the staff record card, tests (allowed and refused, calculation, end to end).
2. Adjustment lines (arrears, bonus, recovery), increments from appraisals, Form 16 and PF / ESI challans, posting salary payments to Expenses.
