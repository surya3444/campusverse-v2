# shared/expenses

Expenses and purchases for any institution type (docs/specs/EXPENSES.md). Places, legal entities and financial years come from platform/organisation; bill photos go through platform/documents. Never reads fee tables.

| Use case                                                 | What                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categories`, `saveCategory`, `installExpenseCategories` | Organisation-wide categories (ten defaults); switched off, never deleted (`expenses.setup.manage`)                                                    |
| `vendors`, `saveVendor`                                  | Organisation-wide vendors with GSTIN; the office adds them while recording (`expenses.bill.record`)                                                   |
| `recordBill`, `billUploadCheck`, `cancelBill`            | A bill with its photo: vendor or payee, number, date (not future), amount and GST; the same vendor's number never twice; the recorder can cancel it   |
| `bill`, `bills`, `billFile`                              | Worklists (waiting, to pay, paid, closed) and one bill with its budget position                                                                       |
| `decideBill`                                             | Approve or reject through platform/workflow: steps, amount limits and escalation from the approval designer; never the recorder (code and database)   |
| `payBill`                                                | Approved bills only, in full; a reference for anything but cash; voucher `PV/2026-27/000001` per legal entity and year, no gaps; payments append-only |
| `budgets`, `setBudget`, `expenseFigures`                 | Budget, committed, paid, waiting and left per category, school and year; over-budget flagged, never blocked                                           |
| `expenseTools`                                           | Verse AI `expenses.summary`: amounts by category, no names                                                                                            |

**Owns:** `expense_category`, `expense_vendor`, `expense_budget`, `expense_bill`, `expense_voucher_counter`, `expense_payment`. **Events:** `expenses.bill.recorded.v1`, `expenses.bill.decided.v1`, `expenses.bill.paid.v1`.

**Not yet:** purchase requests and orders with goods received, part payments, TDS with vendor PAN and bank details (sealed), reversal vouchers, printed vouchers, messages to approvers, Tally export.
