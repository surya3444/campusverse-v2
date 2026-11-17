# Appraisals: spec

Status: **step 1 built** (11 November 2026); step 2 when schools ask. From the platform map (People → Appraisals) and how schools appraise staff today: a yearly form the teacher fills, the principal rates, and both sign. Anything marked _Default_ stands unless the owner changes it.

## Job

Once a year (or term) the principal opens an appraisal for every staff member with the same criteria. Each person rates themselves first, then their reviewer rates them with comments, the weighted score is worked out exactly, and the person reads and acknowledges it. The principal sees where every review stands. Appraisals are private: only the person, their reviewer and those who manage appraisals ever see them.

## Module

**`modules/people/appraisals`**: people, not academics; any institution type appraises staff. Staff of an institution come through people/records (`staffAt`, `memberKind`, `displayNames`).

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table                 | Holds                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appraisal_cycle`     | Institution, name, opens on, closes on, state (`draft`, `open`, `closed`), created by                                                               |
| `appraisal_criterion` | Cycle, position, title, description, weight (1–5)                                                                                                   |
| `appraisal_review`    | Cycle, staff member, reviewer, state (`self`, `review`, `done`, `acknowledged`), self comment, reviewer comment, score (hundredths, numeric), times |
| `appraisal_rating`    | Review, criterion, by (`self`, `reviewer`), score 1–5, comment                                                                                      |

**Rules the database enforces:** one review per person per cycle; the reviewer isn't the person reviewed; scores 1 to 5; a criterion's weight 1 to 5; the overall score between 1 and 5 in hundredths.

**Permissions** (SCHOOL_ROLES, migration, access catalogue, area `people`):

- `people.appraisal.manage`: owner, school admin, principal. Create and open cycles, choose reviewers, see every review, close cycles. **Sensitive**: granting it waits for a second owner.
- `people.appraisal.self`: every staff role, relation `self`: their own review (self-rating, reading the result, acknowledging) and reviews they're the reviewer of.

**Events:** `people.appraisal.reviewed.v1` (the person is told their review is ready).

## Decisions (_Default_, 11 November 2026)

1. **Criteria** start as Subject knowledge and teaching, Classroom management, Student progress, Punctuality and attendance, Teamwork and conduct, Communication with parents: weight 1 each, editable while the cycle is a draft.
2. **Opening** a cycle creates a review for every staff member of the school on that day except the person opening it (preview, then commit); the reviewer is the person who opens it, changeable per review until the reviewer has started.
3. **Order:** self-rating first (every criterion rated, a comment optional), then the reviewer (every criterion rated, a comment required), then the person acknowledges (with an optional reply). Once done, ratings are fixed.
4. **Score** is the weighted average of the reviewer's ratings, rounded half up to hundredths (3.67), computed in whole numbers.
5. **Closing** a cycle stops further changes; unfinished reviews stay as they are.
6. **Verse AI** sees only counts (how many reviews in each state), never ratings or comments.

## Screens

| Screen           | Behaviour                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Appraisals (web) | **My appraisal**: rate yourself, then read the reviewer's ratings and score, acknowledge. **To review**: reviews where you're the reviewer                                     |
| Cycles           | For managers: cycles with progress; **New cycle** (modal: name, dates, criteria); open (preview, then commit); each review's state, reviewer and score; change reviewer; close |

## Steps

1. Cycles with criteria, opening for all staff, self-rating, reviewer rating with the weighted score, acknowledgement, reviewer changes, closing, progress, Verse AI `appraisal.progress` (counts), tests (allowed and refused, end to end).
2. Goals carried between cycles, peer and student feedback, attendance and leave figures beside the form, PDF of a finished review, linking to increments in payroll.
