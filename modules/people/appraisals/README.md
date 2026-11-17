# people/appraisals

Staff appraisals (docs/specs/APPRAISALS.md). Staff from people/records (`staffAt`, `memberKind`).

| Use case                                                        | What                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `cycles`, `saveCycle`, `previewOpen`, `openCycle`, `closeCycle` | Cycles with weighted criteria (`people.appraisal.manage`, sensitive); opening creates a review per staff member, preview first |
| `cycleReviews`, `setReviewer`                                   | Where each review stands; a new reviewer until the reviewer has started                                                        |
| `myAppraisals`, `review`                                        | Your own and the ones you review (`people.appraisal.self`); the person sees the reviewer's ratings only once done              |
| `submitSelf`, `submitReview`, `acknowledge`                     | Every criterion rated; the reviewer's comment required; weighted score in hundredths, half up                                  |
| `appraisalProgress`, `appraisalTools`                           | Counts only, for Verse AI `appraisal.progress`                                                                                 |

**Owns:** `appraisal_cycle`, `appraisal_criterion`, `appraisal_review`, `appraisal_rating`. **Events:** `people.appraisal.reviewed.v1`.

**Not yet:** goals, peer and student feedback, attendance figures beside the form, PDFs, increments.
