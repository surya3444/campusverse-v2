# shared/grievances

Quality & Compliance › Grievances & Committees for any institution type (rule book §13.11, §15;
docs/specs/GRIEVANCES.md). Staff and students come from people/records (`memberKind`,
`displayNames`); messages through communications from the worker.

| Use case                                              | What                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `committees`, `saveCommittee`, `setMembers`           | Committees by kind with days to decide; members are staff (chair, member) or named outside members. Leaders see counts only     |
| `raiseCase`, `myCases`                                | Anyone raises a case, optionally anonymous to the committee; parents about their own child; the raiser follows it               |
| `committeeCases`, `caseDetail`, `addNote`, `moveCase` | Only members see a committee's cases: notes (append-only), inquiry, decision with outcome, close; the raiser appeals in 30 days |
| `recordMeeting`                                       | Minutes of a committee meeting                                                                                                  |
| `grievanceJobs`                                       | Members hear a case number arrived; the raiser hears an outcome is ready. Never the subject or details. Kind `notice`           |

**Owns:** `grievance_committee`, `grievance_member`, `grievance_meeting`, `grievance_case`,
`grievance_note` (migration 0085). **Events:** `grievance.case.raised.v1`, `grievance.case.decided.v1`.
