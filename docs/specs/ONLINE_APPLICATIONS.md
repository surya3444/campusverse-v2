# Online application forms: spec

Status: **step 1 built** (9 November 2026); step 2 (papers, fee, messages) when schools ask.

**Sources:**

- The admissions spec, which set the public form aside: "a public form needs a rate-limited unauthenticated endpoint".
- The platform map's build order, which brings it now ("admission season").
- What admissions already does: one pipeline from enquiry to enrolment, sibling detection, duplicate checks and the owner's admission questions (decision 0020).

Anything marked _Default_ stands unless the owner changes it. The owner asked for fewer questions, so every open point has one.

## Job

A family applies from their phone through a link the school shares (website, WhatsApp, a poster QR) without visiting the office. The school sees the application in its admissions pipeline straight away, already checked for duplicates and siblings. The family can later look up where their application stands with the same phone. The school never retypes a form again.

## Module

The public form lives in **`modules/school/admissions`**: an online application is an ordinary application with `source = 'website'`, so seats, offers and enrolment work unchanged. Two more pieces:

- **Phone check:** a one-time code through platform/identity's OTP, in its own `apply` scope, so a form code can never sign anyone in. Codes are rate-limited per phone and per IP.
- **Public address:** `ops.admission_form_ref` (slug → organisation and form) lets the unauthenticated page find its school, as `ops.payment_ref` does for payment webhooks. Writes made by a family are audited with no actor (like a gateway webhook), and noted as made through the online form.

### Owned tables

| Table                    | Holds                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `school_admission_form`  | Per institution and admission year: the public slug, a title and a short intro, the classes it takes, open or closed, closes on (optional) |
| `school_application`     | Gains `public_ref` (six letters and digits, unique in the organisation: what the family quotes) and `consented_at`                         |
| `ops.admission_form_ref` | Slug → organisation and form (schema ops, allowlisted, no personal data)                                                                   |

**Permissions:** none new. Setting up the form needs `school.admission.manage`; the public side has no session and does only what the phone check allows.

**Events:** `school.admission.applied_online.v1`.

## Decisions (_Default_, 9 November 2026)

1. **One form per school and admission year**, with its own link: `/apply/<slug>`. The slug is made from the school's name plus four random characters, such as `greenfield-7k2m`. The school picks:
   - the classes it takes;
   - a short intro of up to 600 characters, such as fees or a visit day;
   - open or closed, and an optional closing date.

   A closed form says so, and keeps working for status checks.

2. **What a family fills in:**
   - the child's name, date of birth and gender, and the class applied for;
   - the parent or guardian's name, relationship and mobile number;
   - **every active admission question the owner defined**, the same ones the office's enquiry form shows, with the same required rules. File questions wait for papers from the form (step 2), so they aren't asked or required online; the office fills them;
   - a consent tick (its time is kept).

   The age rule for the class is shown as a hint. The office still decides; an out-of-range age needs the office's override, as today.

3. **Mobile check:**
   - Before submitting, the family gets a 6-digit code by SMS on that number and types it in. With no SMS provider (development), the simulated SMS is shown on screen, as at sign-in.
   - At most 3 codes per number and 20 per network address in 15 minutes, and 5 wrong tries per code.
   - Submitting needs a correct, unexpired code; the code is used up.
4. **What submitting does:**
   - An application in state `applied`, source `website`, category `general` (RTE comes only from the RTE portal, as before).
   - It's checked like an office enquiry: the same child and number in the same year shows the existing reference instead of a duplicate, and a number matching a current student's guardian is marked as a likely sibling.
   - The family sees their reference, such as `K7Q2MX`.
   - At most 5 applications per number per form.
5. **Status lookup:**
   - On the same page, **Check an application**: the mobile number plus a fresh code lists that number's applications at this school.
   - Each shows the child's first name, the class and where it stands, in family words: Received, Being reviewed, Papers needed, Offered (until a date), Waiting list, Confirmed, Admitted, Not taken forward, Withdrawn.
   - Nothing else is shown: no notes, no reasons.
6. **The office's side:**
   - Admissions gains an **Online form** panel: set up or edit the form, open or close it, copy the link, and how many applications came through it.
   - Online applications appear in the pipeline marked **Online**.
7. **Abuse and privacy:**
   - Every public endpoint is rate-limited, and the form page shows no school data beyond its name, intro and classes.
   - Guessing slugs reveals only open forms' public text.
   - The status lookup needs the code, so knowing someone's number isn't enough.
8. **Later (step 2):** uploading papers (birth certificate, photo) from the form, an application fee through the payment gateway, and messages to the family when their application moves.

## Screens

| Screen                   | Behaviour                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/apply/<slug>`          | Public, no sign-in, phone first: school name, intro, then the form with **Send code** and **Submit application**; afterwards the reference. **Check an application** below. Closed or unknown links say so plainly |
| Admissions → Online form | Set up or edit in a modal (classes, intro, open, closes on); the link with Copy; online applications count                                                                                                         |
| Admissions pipeline      | An **Online** tag on applications that came through the form                                                                                                                                                       |

## Steps

1. The form setup, the public page with the mobile check, submission into the pipeline, status lookup, the office panel, tests (allowed and refused, rate limits, duplicates, end to end).
2. Papers from the form, an application fee, messages to the family as the application moves.
