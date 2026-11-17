# academics/registration

Academics › Course Registration (rule book §13.2 Registrations, Credit Rules, Elective Baskets; §16.6 step 2; P0 item 13).

- **Window:** one per batch term (`saveWindow`), always for the term the batch is in: dates, minimum and maximum credits (suggested from the program's credit framework, else compulsory to everything), and seats per elective. Changing it later updates the same window.
- **Registering:** `register` gives a student every compulsory course of the term (core, lab, project) plus the chosen electives, checked by `checkSelection`: only this term's electives, within the credit limits, with seats left (seat rows are locked while counting). A change resubmits; an approved registration changed in the window goes back for approval.
- **Parity:** the courses come from academics/structure's `coursesForBatchTerm`, so another semester's course can never be offered or chosen (rule book §4, the "Even Semester 2027 lists semesters 1, 3, 5, 7" defect).
- **Approval:** `decideRegistration` approves, or returns with a reason. Nobody approves a registration they entered. Returned registrations free their seats.

| Permission                       | Who (templates)                         |
| -------------------------------- | --------------------------------------- |
| `academics.structure.read`       | sees the board                          |
| `academics.registration.manage`  | owner, administrator, principal, office |
| `academics.registration.approve` | owner, administrator, principal         |

**Owns:** `registration_window`, `registration_cap`, `course_registration`, `course_registration_item` (migration 0057).

**Events:** `academics.registration.submitted.v1`, `academics.registration.approved.v1` (Timetable, Exams and Fees listen).

**Not yet:** students registering themselves (no student login yet), assigned faculty advisors (approval is by permission at the institution), prerequisites (need results from Exams), allocation by preference or CGPA, open electives across institutes and MOOCs, a confirmation message to the student.
