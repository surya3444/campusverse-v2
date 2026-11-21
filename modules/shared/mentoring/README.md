# shared/mentoring

Students › Mentoring for any institution type (rule book §13.5, §16.4; docs/specs/MENTORING.md).
Students and staff come from people/records (`studentIdsAt`, `staffAt`, `memberKind`); a
student's class through `AcademicPlacementPort`; messages through communications from the worker.
Never reads academic tables.

| Use case                                     | What                                                                                                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allocation`, `assignMentor`                 | Each staff member's mentee count and every student with their mentor; give students a mentor from today (`mentoring.allocation.manage`). One mentor at a time (exclusion); the old one ends today, history kept |
| `myMentees`, `menteeLog`                     | A mentor's own mentees: last check-in, concern, next check-in, open escalations, due after 30 days (`mentoring.mentee.mentor`); one mentee's log for their mentor or a manager                                  |
| `scheduleCheckIn`, `recordCheckIn`           | Check-ins planned for a day, then held (notes and a concern: fine, watch, concern), missed or cancelled; or a check-in held today recorded straight away                                                        |
| `escalate`, `escalations`, `closeEscalation` | To the head of department (`mentoring.allocation.manage`), the counsellor (`mentoring.escalation.counsel`) or the parent; managers see all, a counsellor those sent to them                                     |
| `mentoringJobs`                              | `mentoring.escalation.tell`: staff get the mentor's reason; parents get a template only (restricted guardians nothing). Kind `notice`                                                                           |

**Owns:** `mentor_assignment`, `mentor_meeting`, `mentor_escalation` (migration 0084).
**Events:** `mentoring.escalation.raised.v1`.

**Not yet:** Verse AI early-warning flags as mentor tasks (§16.4 step 2, P2); tasks in My Work;
ratios from HR cadre norms.
