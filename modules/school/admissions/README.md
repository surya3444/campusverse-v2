# school/admissions

One pipeline from enquiry to enrolment (spec: `docs/specs/ADMISSIONS_CERTIFICATES.md`, part 1).

| Step    | Function                                         | Rules                                                                                                                                                                                                     |
| ------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enquiry | `addEnquiry`                                     | Same phone and child in the same year is a duplicate. A phone matching a current student's guardian is flagged as a sibling, never merged. RTE only from the RTE portal source                            |
| Moves   | `moveApplication`, `updateApplication`           | Allowed moves only (`domain/pipeline.ts`); closing needs a reason. An age outside the rule pack needs an override with an order reference                                                                 |
| Seats   | `setSeats`                                       | By class and category; offered, confirmed and enrolled hold a seat                                                                                                                                        |
| Offer   | `offer`                                          | Principal or administrator. Needs a published fee plan for the class (full disclosure) and a seat; expires after 7 days                                                                                   |
| Lapse   | `lapseOffers` (runs before the pipeline is read) | A lapsed offer frees its seat and offers the next waitlisted applicant                                                                                                                                    |
| Confirm | `confirm`                                        | Before the offer expires                                                                                                                                                                                  |
| Enrol   | `enrolApplicant`                                 | One transaction: student record and membership, admission number (`2026-0001`, per year), enrolment, guardian with parent role, fee invoices (instalments already due are not billed), handover checklist |

**On enrolment** the student gets the next roll number in the section (school/enrolment `nextRollNumber`), and `admissionsJobs` sends the family a welcome message (kind `account`, once per student) with the class, admission number and how to sign in to the app.

**Owned tables:** `school_application`, `school_application_event` (append-only), `school_admission_seat`; admission numbers in `school_number_counter` (migration 0010).

**Events:** `school.admission.confirmed.v1`, `school.admission.enrolled.v1`.

**Photo, papers and the owner's questions (Milestone 21):** `applicationDocuments`, `addApplicationDocument`, `checkApplicationDocument`, `openApplicationDocument` (audited), `setApplicationPhoto`, `applicationPhoto` (`school.admission.manage`). Enquiries and edits take the owner's `admission` fields. On enrolment the photo and every paper, with its checks, move to the student's record (people/records `fileDocument`, `setPhotoIn`). Owns `school_application_document`.

**Online application forms (docs/specs/ONLINE_APPLICATIONS.md):** `saveAdmissionForm`, `admissionForms` (`school.admission.manage`): one form per year with a public link (`ops.admission_form_ref`). Public, no session: `publicForm`, `requestApplicationCode`, `submitOnlineApplication` (a code checks the mobile number; checked last, so a form mistake doesn't use it up; audited with no actor), `applicationStatus` (family words only). Owns `school_admission_form`. **Event:** `school.admission.applied_online.v1`.

**Not yet:** papers and an application fee from the online form, messages to families at offer and confirmation (applicants are not people in the system until enrolment, so there is no recipient yet), merit lists and lotteries, two-campus linking, joint twin applications, Class 11 streams, deleting rejected applicants' details after the cycle.
