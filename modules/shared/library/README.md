# shared/library

The library for any institution type (docs/specs/LIBRARY.md). Borrowers are the institution's students and staff from people/records (`searchMembers`, `memberKind`); a student's class comes through `AcademicPlacementPort`. Never reads academic tables.

| Use case                                                        | What                                                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addTitle`, `listTitles`, `titleCopies`                         | The catalogue: titles with copies in and out; search by title, author, ISBN, subject or accession number (`library.book.read` to see, `.manage` to change) |
| `addCopies`, `suggestAccessions`, `withdrawCopy`, `foundCopy`   | Copies by accession number (unique in the institution, next free ones suggested); withdrawn with a reason, never deleted; a lost copy found goes back      |
| `findBorrowers`, `issueBook`                                    | By name, admission number or employee code; within the limit (students 2, staff 5); due after the loan days, a Sunday moving to Monday                     |
| `returnBook`, `renewLoan`, `markLost`, `waiveFine`              | Late returns record the fine (days late × the daily fine, set once); renew while renewals are left; lost charges the copy's price; waive with a reason     |
| `overdueLoans`, `borrowerLoans`, `childLoans`, `libraryFigures` | Overdue with the class or staff; a borrower's loans and fines owed; a guardian's view of their child; the desk's figures                                   |
| `librarySettings`, `updateLibrarySettings`                      | Loan days, limits, renewals, fine per day (₹0: no fines)                                                                                                   |

Fines are recorded here; money is taken by finance (one-off charges come with step 2).

**Owns:** `library_settings`, `library_title`, `library_copy`, `library_loan` (one open loan per copy). **Events:** `library.loan.issued.v1`, `library.loan.returned.v1`.

**Not yet:** catalogue import from a spreadsheet, overdue reminders to guardians, library dues in the TC no-dues check, collecting fines through finance, annual stock check, Verse AI.
