# Library: spec

Status: **step 1 built** (9 November 2026); step 2 when schools ask. Written from the platform map (Operations → Library, build order item 5) and what schools keep on paper today: an accession register, an issue register and an overdue list. Anything marked _Default_ stands unless the owner changes it; the owner asked for fewer questions, so every open point has one.

## Job

The librarian issues a book in seconds by typing or scanning its accession number and finding the borrower. Returns are one field. Overdue books are a list, not a hunt through registers. Parents see what their child has borrowed and when it's due. The school always knows how many copies it has and where they are.

## Module

**`modules/shared/library`**, shared because colleges and universities run libraries the same way.

- Borrowers are the institution's students and staff, found through people/records (`searchMembers`, `staffAt`).
- A student's class comes through `AcademicPlacementPort`.
- The module never reads academic tables.

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table              | Holds                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library_settings` | Per institution: loan days for students (14) and staff (30), most books at once (students 2, staff 5), renewals allowed (1), fine per day late (₹0, so fines are off by default) |
| `library_title`    | Title, authors, ISBN, publisher, year, subject, language, shelf                                                                                                                  |
| `library_copy`     | A copy of a title: accession number (unique in the institution), status (`available`, `on_loan`, `lost`, `withdrawn`), acquired on, price (paise), note                          |
| `library_loan`     | Copy, borrower, issued on, due on, renewals, returned on, issued by, returned by, fine (paise, set at return), fine state (`none`, `owed`, `waived`), waive reason               |

**Rules the database enforces:** one open loan per copy (a partial unique index), and fines in whole paise, never negative.

**Permissions** (SCHOOL_ROLES, migration, access catalogue, area `library`):

- `library.book.read`: every staff role; parents for their own children (relation `guardian`).
- `library.book.manage`: school admin, principal, office. Covers the catalogue, issuing, returns and settings.
- A school that wants a librarian role makes one on the Roles screen with `library.book.manage`.

**Events:** `library.loan.issued.v1`, `library.loan.returned.v1`.

## Decisions (_Default_, 9 November 2026)

1. **Accession numbers** are what's written or stuck in the book: up to 20 letters and digits, unique in the institution. Adding copies suggests the next numbers after the highest one in use, and a school with an existing register types its own.
2. **Issuing:**
   - Type or scan the accession number, then find the borrower by name, admission number or employee code.
   - The copy must be available and the borrower within their limit.
   - The due date is today plus the loan days; one landing on a Sunday moves to Monday.
   - A borrower with an overdue book can still borrow, with a warning, because many schools allow it.
3. **Returning:** type the accession number.
   - If the book is late and the school charges fines, the fine is days late × the daily fine, set at return and never recalculated.
   - The librarian can waive it with a reason.
4. **Renewing:** once by default, from today for another loan period, and only while the copy is out.
5. **Lost:**
   - A loan can be closed as lost, and the copy becomes `lost`.
   - The fine is the copy's price if one is recorded, otherwise ₹0 for the office to settle.
   - A lost copy that turns up can be returned to the shelf.
6. **Money:**
   - The library records fines but takes no money: receipts belong to finance.
   - Until finance has one-off charges (step 2), owed fines show on the borrower and in the overdue view, and the librarian can waive them with a reason.
7. **Withdrawn copies** (worn out, given away) stay in the register as `withdrawn`, never deleted. Withdrawing a copy needs a reason.
8. **Parents** see their child's books on loan with due dates, and owed fines, in the app.
9. **Students leaving:** a borrower who has left still shows on the overdue list until the book comes back.

## Screens

| Screen        | Behaviour                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library (web) | **Desk**: Issue (accession number, borrower search) and Return (accession number) side by side, with what just happened. Key figures: on loan, overdue, copies |
| Catalogue     | Search titles; each with its copies and where they are. **Add title** and **Add copies** in modals; withdraw a copy with a reason                              |
| Overdue       | Every overdue loan: borrower, class or staff, book, days late, fine; Return, Renew, Lost                                                                       |
| Borrower      | From a search: their loans now and before, and fines owed, with Waive                                                                                          |
| Settings      | Loan days, limits, renewals, fine per day                                                                                                                      |
| Parent app    | A **Library** line on each child: books on loan with due dates                                                                                                 |

## Steps

1. Catalogue (titles, copies, accession numbers), issue, return, renew, lost, limits and due dates, fines recorded and waived, overdue list, borrower view, settings, the parent app, tests (allowed and refused, end to end).
2. Catalogue import from a spreadsheet (preview, then commit), overdue reminders to guardians, library dues in the TC (transfer certificate) no-dues check, collecting fines through finance, annual stock check, Verse AI `library.summary`.
