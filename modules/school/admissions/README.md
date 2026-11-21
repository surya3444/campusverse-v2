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

**Seat draws (docs/specs/SEAT_DRAWS.md):** `draws`, `startDraw`, `drawDetail`, `publishDraw`, `discardDraw` (`domain/draw.ts`): an RTE lottery or first come for one class and category, from a recorded seed and frozen inputs that can be run again; published by someone other than who drew it into offers and an ordered waitlist; set-aside draws stay on record. Owns `school_admission_draw` (migration 0088).

**Admissions CRM (docs/specs/ADMISSIONS_CRM.md; migration 0090; `application/crm.ts`):**

- **Leads:** an owner (anyone holding `school.admission.manage` at the campus), interest (hot, warm, cold), a campaign tag (`updateLead`). The pipeline read carries each lead's last contact, next follow-up, paper progress and latest form link.
- **Timeline:** `logActivity` (call, WhatsApp, SMS, email, visit, note; with an outcome; optionally the next follow-up). Reaching the family moves an enquiry to Contacted. `timelineOf` merges stage changes, activity, follow-ups, form links and paper checks.
- **Follow-ups:** `scheduleFollowUp`, `completeFollowUp` (with what happened and optionally the next), `followUps` (open, and done in 14 days); `next_follow_up` follows the earliest open one.
- **Personal form links:** `sendInvite` (apply) and `requestPapers` (papers; moves the application to Papers needed and lists what is missing or rejected, with the reason). Only the token's SHA-256 hash is kept; links work 14 days (apply) or 7 (papers), once. The message comes back to send from the office's own WhatsApp, messages or email app: no SMS or email provider is connected, and messages to people who aren't in the system yet don't go through Communications.
- **Verification:** the form's papers (`papers`, with required ones) make a checklist (`checklistOf`); `verifyApplication` needs every required paper accepted, records who and when, and moves the application to review.
- **Bulk upload:** `previewLeadImport`, `importLeads` (ready rows only; duplicates by mobile and child this year are skipped), `leadImports`, `undoLeadImport` (untouched leads closed as lost, "Bulk upload undone"; history kept).
- **Records:** `applicationRecord` (everything the application page shows), `studentAdmission` (the student record's Admission card).

**The public form, step 2 (online.ts):** `startApplication` checks the mobile code first and gives a signed two-hour session (with a personal link, only a mobile the school has for that application). `uploadPaper` stores a family's paper (scanned like any file; `storeFileIn`) and returns a ticket bound to the mobile and form; `submitOnlineApplication` takes the session and tickets (a personal link completes its lead; missing required papers leave it as Papers needed); `sendPapers` sends papers asked for later; `applicationStatus` lists what is still needed with a session to send it. Forms choose their sections (second parent, address, background, previous school, health) and papers.

**Enrolment** also carries the second parent (found or created, with parent access), both parents' emails as contacts, the child's background, address, previous school and health notes (`setStudentDetailsIn`), the school's own questions where the student record asks the same one with the same type, and the current copy of each paper.

**Owned tables (0090):** `school_admission_activity` (append-only), `school_admission_follow_up`, `school_admission_invite`, `school_admission_import`; new columns on `school_application`, `school_application_document` (family uploads), `school_admission_form` (papers, sections).

**Years:** admissions work only in the school's own years (`admissionYears`: running and coming years, and older ones that still have open families), never years guessed from the calendar (`year_not_set_up`, `year_not_open`). A year offers the classes it runs (`class_not_in_year`), seats default to its open sections' places, and enrolment goes into that year's open sections from a day inside it (`from_outside_year`, `section_closed`). A class added in Classes shows up at once.

**For finance:** `admissionInProgress` tells finance whether a family (by phone or email) has an application in progress at an institution, or a child admitted there in the last 90 days; donations are refused from them.

**Not yet:** an application fee through the form, automatic SMS, WhatsApp or email to families (no provider is connected; personal links go from the office's own apps), counsellor performance and campaign return reports, college merit lists, two-campus linking, joint twin applications, Class 11 streams, deleting rejected applicants' details after the cycle.
