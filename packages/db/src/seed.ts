import { sql } from 'drizzle-orm';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { withTenant, type Db } from './client.js';
import {
  campus,
  guardianLink,
  institution,
  legalEntity,
  organisation,
  person,
  role,
  roleAssignment,
  roleGrant,
  staffDuty,
} from './schema.js';

export type SeededTenant = {
  orgId: string;
  legalEntityId: string;
  campusId: string;
  institutionId: string;
  principalId: string;
  teacherId: string;
  studentId: string;
  guardianId: string;
};

const one = <T>(rows: T[]): T => {
  const row = rows[0];
  if (!row) throw new Error('seedTenant: insert returned no row');
  return row;
};

/**
 * Synthetic tenant with a row in every tenant table: one CBSE school, a principal, a teacher
 * on a week's exam duty, a student and their guardian. Never real data.
 */
export async function seedTenant(db: Db, name: string, orgId?: string): Promise<SeededTenant> {
  const id = orgId ?? (await newId(db));
  return withTenant(db, id, async (tx) => {
    await tx.insert(organisation).values({ id, name });
    const le = one(
      await tx
        .insert(legalEntity)
        .values({ orgId: id, name: `${name} Educational Trust` })
        .returning({ id: legalEntity.id }),
    );
    const ca = one(
      await tx
        .insert(campus)
        .values({ orgId: id, name: `${name} Main Campus` })
        .returning({ id: campus.id }),
    );
    const inst = one(
      await tx
        .insert(institution)
        .values({
          orgId: id,
          campusId: ca.id,
          legalEntityId: le.id,
          type: 'school',
          authorityCode: 'CBSE',
          name: `${name} Public School`,
        })
        .returning({ id: institution.id }),
    );

    const people = await tx
      .insert(person)
      .values(
        ['Principal', 'Teacher', 'Student', 'Guardian'].map((r) => ({
          orgId: id,
          legalName: `Synthetic ${r} ${name}`,
        })),
      )
      .returning({ id: person.id });
    const [principalId, teacherId, studentId, guardianId] = people.map((p) => p.id);
    if (!principalId || !teacherId || !studentId || !guardianId) throw new Error('seed: people');

    const [principalRole, parentRole] = await tx
      .insert(role)
      .values([
        { orgId: id, key: 'principal', name: 'Principal' },
        { orgId: id, key: 'parent', name: 'Parent' },
      ])
      .returning({ id: role.id });
    if (!principalRole || !parentRole) throw new Error('seed: roles');

    await tx.insert(roleGrant).values([
      { orgId: id, roleId: principalRole.id, permission: 'people.student.read' },
      { orgId: id, roleId: parentRole.id, permission: 'people.student.read', relation: 'guardian' },
    ]);
    await tx.insert(roleAssignment).values([
      {
        orgId: id,
        personId: principalId,
        roleId: principalRole.id,
        scopeType: 'institution',
        scopeId: inst.id,
      },
      {
        orgId: id,
        personId: guardianId,
        roleId: parentRole.id,
        scopeType: 'organisation',
        scopeId: id,
      },
    ]);
    await tx.insert(guardianLink).values({
      orgId: id,
      guardianPersonId: guardianId,
      studentPersonId: studentId,
      relationship: 'mother',
    });
    await tx.insert(staffDuty).values({
      orgId: id,
      personId: teacherId,
      duty: 'exam_superintendent',
      roleId: principalRole.id,
      scopeType: 'institution',
      scopeId: inst.id,
      validDuring: sql`daterange(app_today(), app_today() + 7)`,
    });

    const noticeBody = 'Synthetic notice: school may publish class photos.';
    const [notice] = await tx.execute<{ id: string }>(sql`
      insert into consent_notice (org_id, purpose, version, language, body_sha256, body)
      values (${id}, 'photo_publication', 1, 'en',
        ${createHash('sha256').update(noticeBody).digest('hex')}, ${noticeBody})
      returning id`);
    await tx.execute(sql`
      insert into consent_record
        (org_id, student_person_id, guardian_person_id, notice_id, purpose, decision, source)
      values (${id}, ${studentId}, ${guardianId}, ${notice?.id}, 'photo_publication', 'granted', 'office')`);
    const [contact] = await tx.execute<{ id: string }>(sql`
      insert into person_contact (org_id, person_id, channel, address)
      values (${id}, ${guardianId}, 'sms', ${syntheticPhone()}) returning id`);
    const [message] = await tx.execute<{ id: string }>(sql`
      insert into notification_message
        (org_id, recipient_person_id, kind, language, title, body, dedupe_key)
      values (${id}, ${guardianId}, 'notice', 'en', 'Synthetic notice', 'School reopens Monday.',
        ${`seed:${id}`}) returning id`);
    await tx.execute(sql`
      insert into notification_delivery (org_id, message_id, channel, contact_id, attempt_order)
      values (${id}, ${message?.id}, 'sms', ${contact?.id}, 1)`);
    await tx.execute(sql`
      insert into stored_file (org_id, purpose, file_name, content_type, size_bytes, storage_key)
      values (${id}, 'birth_certificate', 'synthetic.pdf', 'application/pdf', 1024,
        ${`${id}/files/seed-${randomUUID()}`})`);
    await tx.execute(sql`
      insert into audit_event (org_id, action, entity_type, entity_id, data_class)
      values (${id}, 'platform.organisation.create', 'organisation', ${id}, 'operational')`);
    // The Activity Log's first seal, computed as platform/audit's chainLink does.
    await tx.execute(sql`
      insert into audit_seal (org_id, upto_event_id, event_count, chain_sha256)
      select org_id, id, 1, encode(sha256(convert_to(concat_ws(chr(31), repeat('0', 64), id::text,
          to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          coalesce(actor_account_id::text, ''), coalesce(actor_person_id::text, ''), action, entity_type,
          coalesce(entity_id::text, ''), data_class, coalesce(reason, ''), detail::text), 'UTF8')), 'hex')
      from audit_event where org_id = ${id} and action = 'platform.organisation.create'`);
    await tx.execute(sql`
      insert into issued_document (org_id, kind, number, subject_person_id, sha256, storage_key,
        verification_code)
      values (${id}, 'bonafide', ${`SEED-${randomUUID()}`}, ${studentId}, ${'0'.repeat(64)},
        ${`${id}/documents/seed-${randomUUID()}.pdf`}, ${randomUUID().replaceAll('-', '')})`);

    // School structure: one year, Class 5, section A, English, with the teacher and student placed.
    const first = async (q: ReturnType<typeof sql>) => {
      const [row] = await tx.execute<{ id: string }>(q);
      if (!row) throw new Error('seedTenant: insert returned no row');
      return row.id;
    };
    const yearId = await first(sql`
      insert into school_year (org_id, institution_id, label, valid_during, status)
      values (${id}, ${inst.id}, '2026-27', daterange('2026-04-01', '2027-04-01'), 'active') returning id`);
    const classId = await first(sql`
      insert into school_class (org_id, institution_id, code, name, sequence)
      values (${id}, ${inst.id}, '5', 'Class 5', 6) returning id`);
    const sectionId = await first(sql`
      insert into school_section (org_id, year_id, class_id, name, capacity)
      values (${id}, ${yearId}, ${classId}, 'A', 40) returning id`);
    const subjectId = await first(sql`
      insert into school_subject (org_id, institution_id, code, name)
      values (${id}, ${inst.id}, 'ENG', 'English') returning id`);
    await tx.execute(sql`
      insert into school_subject_offering (org_id, year_id, class_id, subject_id)
      values (${id}, ${yearId}, ${classId}, ${subjectId})`);
    const batchId = await first(sql`
      insert into import_batch (org_id, institution_id, kind, file_name)
      values (${id}, ${inst.id}, 'students', 'synthetic.xlsx') returning id`);
    await tx.execute(sql`
      insert into import_row (org_id, batch_id, row_number, status, data)
      values (${id}, ${batchId}, 1, 'valid', '{}')`);
    await tx.execute(sql`
      insert into staff_profile (org_id, person_id, employee_code, category)
      values (${id}, ${teacherId}, ${`EMP-${randomInt(1e6)}`}, 'teaching')`);
    await tx.execute(sql`
      insert into staff_check (org_id, person_id, kind, reference, checked_on, recorded_by_person_id)
      values (${id}, ${teacherId}, 'police_verification', 'PV-SYNTH-1', '2026-06-01', ${principalId})`);
    await tx.execute(sql`
      insert into school_teacher_allocation (org_id, section_id, teacher_person_id, kind)
      values (${id}, ${sectionId}, ${teacherId}, 'class_teacher')`);
    // A published timetable: Monday to Friday, two periods, English first period on Monday.
    const timetableId = await first(sql`
      insert into school_timetable (org_id, institution_id, year_id, name, days, created_by_person_id)
      values (${id}, ${inst.id}, ${yearId}, 'Term 1', '{1,2,3,4,5}', ${principalId}) returning id`);
    await tx.execute(sql`
      insert into school_timetable_period (org_id, timetable_id, number, starts_at, ends_at, kind)
      values (${id}, ${timetableId}, 1, '08:00', '08:40', 'class'),
        (${id}, ${timetableId}, 2, '08:40', '09:20', 'class')`);
    await tx.execute(sql`
      insert into school_timetable_slot (org_id, timetable_id, section_id, weekday, period, subject_id,
        teacher_person_id, room)
      values (${id}, ${timetableId}, ${sectionId}, 1, 1, ${subjectId}, ${teacherId}, 'Room 5')`);
    // A teaching group (languages) of 5-A, meeting on Wednesday in period 2.
    const groupId = await first(sql`
      insert into school_timetable_group (org_id, timetable_id, name)
      values (${id}, ${timetableId}, 'Languages') returning id`);
    await tx.execute(sql`
      insert into school_timetable_group_section (org_id, group_id, section_id)
      values (${id}, ${groupId}, ${sectionId})`);
    await tx.execute(sql`
      insert into school_timetable_slot (org_id, timetable_id, group_id, weekday, period, subject_id)
      values (${id}, ${timetableId}, ${groupId}, 3, 2, ${subjectId})`);
    // A generation that was worked out and placed.
    await tx.execute(sql`
      insert into school_timetable_generation (org_id, timetable_id, rules, draft_stamp, state, result,
        requested_by_person_id, finished_at, placed_by_person_id, placed_at)
      values (${id}, ${timetableId}, '{}', 'seed', 'placed', '{"placed": []}', ${principalId}, now(),
        ${principalId}, now())`);
    await tx.execute(sql`
      update school_timetable set state = 'published', effective_from = '2026-06-01', published_at = now(),
        published_by_person_id = ${principalId}
      where org_id = ${id} and id = ${timetableId}`);
    // The teacher was away on Monday 8 June; the principal supervised the class.
    await tx.execute(sql`
      insert into school_cover (org_id, institution_id, cover_date, slot_id, period, absent_person_id, kind,
        assigned_by_person_id)
      select org_id, ${inst.id}, '2026-06-08', id, period, teacher_person_id, 'supervised', ${principalId}
      from school_timetable_slot where org_id = ${id} and timetable_id = ${timetableId}
        and section_id is not null`);
    // A teacher's calendar link, since stopped (only the secret's hash is ever kept).
    await tx.execute(sql`
      insert into school_timetable_feed (org_id, person_id, token_hash, revoked_at)
      values (${id}, ${teacherId}, ${'0'.repeat(64)}, now())`);
    await tx.execute(sql`
      insert into school_enrolment (org_id, person_id, institution_id, section_id, admission_number,
        roll_number, valid_during)
      values (${id}, ${studentId}, ${inst.id}, ${sectionId}, ${`ADM-${randomInt(1e6)}`}, 1,
        daterange('2026-04-01', '2027-04-01'))`);

    await tx.execute(sql`
      insert into person_name (org_id, person_id, legal_name, source)
      values (${id}, ${studentId}, ${`Synthetic Student ${name}`}, 'admission')`);
    await tx.execute(sql`
      insert into student_profile (org_id, person_id, gender) values (${id}, ${studentId}, 'not_stated')`);
    await tx.execute(sql`
      insert into institution_membership (org_id, person_id, institution_id, kind, valid_during)
      values (${id}, ${studentId}, ${inst.id}, 'student', daterange('2026-04-01', '2027-04-01')),
             (${id}, ${teacherId}, ${inst.id}, 'staff', daterange(app_today(), NULL))`);
    await tx.execute(sql`
      insert into person_document (org_id, person_id, kind, requirement)
      values (${id}, ${studentId}, 'birth_certificate', 'required')`);

    // A staff document, attendance settings, a check-in and the day it made (Milestone 20).
    const docFileId = await first(sql`
      insert into stored_file (org_id, purpose, file_name, content_type, size_bytes, storage_key)
      values (${id}, 'document', 'degree.pdf', 'application/pdf', 1000, ${`${id}/seed/degree`})
      returning id`);
    await tx.execute(sql`
      insert into record_document (org_id, person_id, folder, kind, title, file_id, uploaded_by_person_id)
      values (${id}, ${teacherId}, 'qualifications', 'degree', 'B.Ed. certificate', ${docFileId}, ${principalId})`);
    await tx.execute(sql`
      insert into staff_attendance_settings (org_id, institution_id) values (${id}, ${inst.id})`);
    await tx.execute(sql`
      insert into staff_attendance_checkin (org_id, id, person_id, institution_id, direction, at, source)
      values (${id}, uuidv7(), ${teacherId}, ${inst.id}, 'in', now(), 'web')`);
    await tx.execute(sql`
      insert into staff_attendance_day (org_id, person_id, institution_id, on_date, status, first_in, source)
      values (${id}, ${teacherId}, ${inst.id}, app_today(), 'present', now(), 'checkin')`);

    // The library (docs/specs/LIBRARY.md): settings, a title, a copy and a loan.
    await tx.execute(sql`
      insert into library_settings (org_id, institution_id) values (${id}, ${inst.id})`);
    const titleId = await first(sql`
      insert into library_title (org_id, institution_id, title, authors)
      values (${id}, ${inst.id}, 'Synthetic Stories', 'A. Writer') returning id`);
    const copyId = await first(sql`
      insert into library_copy (org_id, institution_id, title_id, accession_no, status)
      values (${id}, ${inst.id}, ${titleId}, 'ACC-0001', 'on_loan') returning id`);
    await tx.execute(sql`
      insert into library_loan (org_id, institution_id, copy_id, borrower_person_id, borrower_kind, issued_on, due_on,
        issued_by_person_id)
      values (${id}, ${inst.id}, ${copyId}, ${studentId}, 'student', app_today(), app_today() + 14, ${principalId})`);

    // Visitors and gate (docs/specs/VISITORS_GATE.md): a visitor inside to see the teacher, and a
    // gate pass for the student, collected by their guardian.
    const visitorId = await first(sql`
      insert into gate_visitor (org_id, phone, name) values (${id}, ${syntheticPhone()}, 'Synthetic Visitor')
      returning id`);
    await tx.execute(sql`
      insert into gate_visit (org_id, institution_id, visitor_id, purpose, host_person_id, state, in_at, in_by_person_id)
      values (${id}, ${inst.id}, ${visitorId}, 'parent_meeting', ${teacherId}, 'in', now(), ${principalId})`);
    await tx.execute(sql`
      insert into gate_pass (org_id, institution_id, student_person_id, collector_guardian_id, collector_name,
        collector_relation, reason, issued_on, issued_by_person_id)
      values (${id}, ${inst.id}, ${studentId}, ${guardianId}, 'Synthetic Guardian', 'mother', 'Doctor visit',
        app_today(), ${principalId})`);

    // Expenses (docs/specs/EXPENSES.md): a category, vendor and budget, and a bill recorded by the
    // teacher, approved by the principal and paid with a voucher.
    const categoryId = await first(sql`
      insert into expense_category (org_id, name) values (${id}, 'Repairs and maintenance') returning id`);
    const vendorId = await first(sql`
      insert into expense_vendor (org_id, name) values (${id}, 'Synthetic Plumbing Works') returning id`);
    await tx.execute(sql`
      insert into expense_budget (org_id, institution_id, category_id, financial_year, amount_paise)
      values (${id}, ${inst.id}, ${categoryId}, '2026-27', 5000000)`);
    const billId = await first(sql`
      insert into expense_bill (org_id, institution_id, legal_entity_id, financial_year, category_id, vendor_id,
        bill_no, bill_date, description, amount_paise, state, recorded_by_person_id, decided_by_person_id, decided_at)
      values (${id}, ${inst.id}, ${le.id}, '2026-27', ${categoryId}, ${vendorId}, 'SPW-1', '2026-11-01',
        'Tap repairs', 120000, 'paid', ${teacherId}, ${principalId}, now())
      returning id`);
    await tx.execute(sql`
      insert into expense_voucher_counter (org_id, legal_entity_id, financial_year, next_number)
      values (${id}, ${le.id}, '2026-27', 2)`);
    await tx.execute(sql`
      insert into expense_payment (org_id, bill_id, legal_entity_id, financial_year, voucher_no, mode, paid_on,
        amount_paise, paid_by_person_id)
      values (${id}, ${billId}, ${le.id}, '2026-27', 'PV/2026-27/000001', 'cash', '2026-11-02', 120000, ${principalId})`);

    // Hostel (docs/specs/HOSTEL.md): a hostel and room, the student in bed 1, tonight's roll call
    // and an outpass collected by their guardian.
    const hostelId = await first(sql`
      insert into hostel (org_id, institution_id, name, kind) values (${id}, ${inst.id}, 'Synthetic Hostel', 'mixed')
      returning id`);
    const roomId = await first(sql`
      insert into hostel_room (org_id, hostel_id, number, beds) values (${id}, ${hostelId}, '101', 3) returning id`);
    await tx.execute(sql`
      insert into hostel_allocation (org_id, hostel_id, room_id, bed_no, student_person_id, valid_during,
        allocated_by_person_id)
      values (${id}, ${hostelId}, ${roomId}, 1, ${studentId}, daterange(app_today() - 30, null), ${principalId})`);
    const rollCallId = await first(sql`
      insert into hostel_roll_call (org_id, hostel_id, on_date, session, taken_by_person_id)
      values (${id}, ${hostelId}, app_today() - 1, 'night', ${principalId}) returning id`);
    await tx.execute(sql`
      insert into hostel_roll_mark (org_id, roll_call_id, student_person_id, status)
      values (${id}, ${rollCallId}, ${studentId}, 'present')`);
    await tx.execute(sql`
      insert into hostel_outpass (org_id, hostel_id, student_person_id, leaves_on, back_by, reason,
        collector_guardian_id, collector_name, collector_relation, state, requested_by_person_id)
      values (${id}, ${hostelId}, ${studentId}, app_today() + 7, app_today() + 9, 'Family wedding',
        ${guardianId}, 'Synthetic Guardian', 'mother', 'requested', ${guardianId})`);

    // Syllabus (docs/specs/SYLLABUS.md): a unit, ticked done for the section, and a lesson plan.
    const unitId = await first(sql`
      insert into school_syllabus_unit (org_id, year_id, class_id, subject_id, position, title, planned_month)
      values (${id}, ${yearId}, ${classId}, ${subjectId}, 1, 'Synthetic Poems', '2026-06-01') returning id`);
    await tx.execute(sql`
      insert into school_syllabus_progress (org_id, unit_id, section_id, completed_on, completed_by_person_id)
      values (${id}, ${unitId}, ${sectionId}, '2026-07-01', ${teacherId})`);
    await tx.execute(sql`
      insert into school_lesson_plan (org_id, section_id, subject_id, unit_id, on_date, plan, written_by_person_id)
      values (${id}, ${sectionId}, ${subjectId}, ${unitId}, '2026-07-01', 'Read and recite', ${teacherId})`);

    // Helpdesk (docs/specs/HELPDESK.md): a category, a parent's request about the student, a reply.
    const helpCategoryId = await first(sql`
      insert into helpdesk_category (org_id, name, hours, assignee_person_id)
      values (${id}, 'Transport', 8, ${principalId}) returning id`);
    await tx.execute(sql`
      insert into helpdesk_counter (org_id, institution_id, next_number) values (${id}, ${inst.id}, 2)`);
    const ticketId = await first(sql`
      insert into helpdesk_ticket (org_id, institution_id, number, category_id, raised_by_person_id, student_person_id,
        subject, assignee_person_id, due_at)
      values (${id}, ${inst.id}, 1, ${helpCategoryId}, ${guardianId}, ${studentId}, 'Bus was late', ${principalId},
        now() + interval '8 hours') returning id`);
    await tx.execute(sql`
      insert into helpdesk_message (org_id, ticket_id, author_person_id, body)
      values (${id}, ${ticketId}, ${guardianId}, 'The bus came 30 minutes late today.')`);

    // Privacy & Consent (rule book §13.12): a closed data-rights request and a closed breach.
    await tx.execute(sql`
      insert into consent_rights_request (org_id, number, kind, requester_name, subject_person_id, details,
        state, outcome, received_at, due_at, closed_at)
      values (${id}, 1, 'access', 'Synthetic Guardian', ${studentId}, 'A copy of the record.', 'done',
        'Sent by email.', now() - interval '10 days', now() + interval '20 days', now() - interval '9 days')`);
    await tx.execute(sql`
      insert into consent_breach (org_id, title, description, severity, discovered_at, cert_in_reported_at, closed_at)
      values (${id}, 'Synthetic test incident', 'A test entry.', 'low', now() - interval '2 days',
        now() - interval '2 days' + interval '1 hour', now() - interval '1 day')`);

    // Health Connect (rule book §13.9): placeholder rows (bytes aren't sealed values), on the
    // guardian so no test that reads the student's health record meets them.
    await tx.execute(sql`
      insert into health_record (org_id, student_person_id, vault, has_allergies)
      values (${id}, ${guardianId}, '\\x00'::bytea, true)`);
    await tx.execute(sql`
      insert into health_visit (org_id, institution_id, student_person_id, notes, outcome)
      values (${id}, ${inst.id}, ${guardianId}, '\\x00'::bytea, 'back_to_class')`);
    await tx.execute(sql`
      insert into health_break_glass (org_id, student_person_id, opened_by_person_id, reason, expires_at)
      values (${id}, ${guardianId}, ${principalId}, 'Synthetic emergency drill', now() + interval '1 hour')`);
    const medicineId = await first(sql`
      insert into health_medicine (org_id, institution_id, name, unit, reorder_level)
      values (${id}, ${inst.id}, 'Synthetic paracetamol', 'tablet', 10) returning id`);
    const medicineBatchId = await first(sql`
      insert into health_medicine_batch (org_id, medicine_id, expires_on, received, remaining)
      values (${id}, ${medicineId}, current_date + 365, 20, 20) returning id`);
    await tx.execute(sql`
      insert into health_medicine_move (org_id, medicine_id, batch_id, kind, quantity, by_person_id)
      values (${id}, ${medicineId}, ${medicineBatchId}, 'receive', 20, ${principalId})`);
    await tx.execute(sql`
      insert into health_partner (org_id, institution_id, name, kind, phone)
      values (${id}, ${inst.id}, 'Synthetic General Hospital', 'hospital', '0000000000')`);
    await tx.execute(sql`
      insert into health_incident (org_id, institution_id, kind, location, raised_by_person_id)
      values (${id}, ${inst.id}, 'other', 'Synthetic drill ground', ${principalId})`);
    // Mentoring: on the guardian, so no mentee list meets it.
    await tx.execute(sql`
      insert into mentor_assignment (org_id, institution_id, student_person_id, mentor_person_id,
        valid_during, assigned_by_person_id)
      values (${id}, ${inst.id}, ${guardianId}, ${teacherId}, daterange(current_date, null), ${principalId})`);
    await tx.execute(sql`
      insert into mentor_meeting (org_id, institution_id, student_person_id, mentor_person_id, scheduled_for)
      values (${id}, ${inst.id}, ${guardianId}, ${teacherId}, current_date + 7)`);
    await tx.execute(sql`
      insert into mentor_escalation (org_id, institution_id, student_person_id, raised_by_person_id,
        escalated_to, reason)
      values (${id}, ${inst.id}, ${guardianId}, ${teacherId}, 'hod', 'Synthetic escalation for the seed')`);
    const committeeId = await first(sql`
      insert into grievance_committee (org_id, institution_id, kind, name, decide_days)
      values (${id}, ${inst.id}, 'other', 'Synthetic Seed Committee', 30) returning id`);
    await tx.execute(sql`
      insert into grievance_member (org_id, committee_id, person_id, role)
      values (${id}, ${committeeId}, ${principalId}, 'chair')`);
    await tx.execute(sql`
      insert into grievance_meeting (org_id, committee_id, held_on, minutes, recorded_by_person_id)
      values (${id}, ${committeeId}, current_date, 'Synthetic minutes', ${principalId})`);
    const grievanceCaseId = await first(sql`
      insert into grievance_case (org_id, committee_id, number, raised_by_person_id, subject, details,
        received_on, due_on)
      values (${id}, ${committeeId}, 1, ${guardianId}, 'Synthetic subject', 'Synthetic details for the seed',
        current_date, current_date + 30) returning id`);
    await tx.execute(sql`
      insert into grievance_note (org_id, case_id, author_person_id, body)
      values (${id}, ${grievanceCaseId}, ${principalId}, 'Synthetic note')`);
    // Surveys: closed, so it never shows up for anyone to answer.
    const surveyId = await first(sql`
      insert into survey (org_id, institution_id, kind, title, audience, opens_on, closes_on, state,
        created_by_person_id)
      values (${id}, ${inst.id}, 'other', 'Synthetic seed survey', 'staff', current_date - 7, current_date - 1,
        'closed', ${principalId}) returning id`);
    const surveyQuestionId = await first(sql`
      insert into survey_question (org_id, survey_id, position, kind, prompt, weight)
      values (${id}, ${surveyId}, 0, 'rating', 'Synthetic question', 1) returning id`);
    await tx.execute(sql`
      insert into survey_receipt (org_id, survey_id, person_id) values (${id}, ${surveyId}, ${principalId})`);
    const surveyResponseId = await first(sql`
      insert into survey_response (org_id, survey_id, submitted_on)
      values (${id}, ${surveyId}, current_date - 2) returning id`);
    await tx.execute(sql`
      insert into survey_answer (org_id, response_id, question_id, rating)
      values (${id}, ${surveyResponseId}, ${surveyQuestionId}, 4)`);
    await tx.execute(sql`
      insert into survey_action (org_id, survey_id, title, owner_person_id, due_on)
      values (${id}, ${surveyId}, 'Synthetic action', ${principalId}, current_date + 30)`);
    // Assessments: one question on one draft paper.
    const assessmentQuestionId = await first(sql`
      insert into assessment_question (org_id, institution_id, subject, kind, prompt, marks, difficulty, bloom,
        created_by_person_id)
      values (${id}, ${inst.id}, 'Synthetic subject', 'long', 'Synthetic question', 5, 'medium', 'apply',
        ${principalId}) returning id`);
    const assessmentPaperId = await first(sql`
      insert into assessment_paper (org_id, institution_id, title, subject, created_by_person_id)
      values (${id}, ${inst.id}, 'Synthetic paper', 'Synthetic subject', ${principalId}) returning id`);
    await tx.execute(sql`
      insert into assessment_paper_item (org_id, paper_id, position, question_id, kind, prompt, marks, difficulty,
        bloom)
      values (${id}, ${assessmentPaperId}, 0, ${assessmentQuestionId}, 'long', 'Synthetic question', 5, 'medium', 'apply')`);

    // The academic engine (rule book §12.4 decisions 2–3): one row in each table, enrolment on the
    // guardian so no student list meets it. Curriculum goes in before the regulation is published.
    const academicProgramId = await first(sql`
      insert into academic_program (org_id, institution_id, code, name, level, term_kind, terms)
      values (${id}, ${inst.id}, 'BSC-SYN', 'Synthetic B.Sc.', 'ug', 'semester', 6) returning id`);
    const academicRegulationId = await first(sql`
      insert into academic_regulation (org_id, program_id, code, version, effective_from)
      values (${id}, ${academicProgramId}, 'R25', 1, '2025-06-01') returning id`);
    const academicCourseId = await first(sql`
      insert into academic_course (org_id, institution_id, code, title)
      values (${id}, ${inst.id}, 'SYN101', 'Synthetic course') returning id`);
    await tx.execute(sql`
      insert into academic_curriculum (org_id, regulation_id, course_id, term_number, kind, lecture, credits)
      values (${id}, ${academicRegulationId}, ${academicCourseId}, 1, 'core', 4, 4)`);
    await tx.execute(sql`
      update academic_regulation set status = 'published', published_at = now()
      where org_id = ${id} and id = ${academicRegulationId}`);
    const academicBatchId = await first(sql`
      insert into academic_batch (org_id, program_id, regulation_id, label, start_year)
      values (${id}, ${academicProgramId}, ${academicRegulationId}, '2025–28', 2025) returning id`);
    await tx.execute(sql`
      insert into academic_term (org_id, batch_id, number, starts_on, ends_on)
      values (${id}, ${academicBatchId}, 1, '2025-07-01', '2025-11-30')`);
    const academicSectionId = await first(sql`
      insert into academic_section (org_id, batch_id, name) values (${id}, ${academicBatchId}, 'A') returning id`);
    await tx.execute(sql`
      insert into academic_enrolment (org_id, batch_id, section_id, student_person_id, from_term)
      values (${id}, ${academicBatchId}, ${academicSectionId}, ${guardianId}, 1)`);

    // College exams: a mark, a lock and a published result on the synthetic batch (the guardian).
    await tx.execute(sql`
      insert into exam_mark (org_id, batch_id, term_number, course_id, student_person_id, cie, see, entered_by_person_id)
      values (${id}, ${academicBatchId}, 1, ${academicCourseId}, ${guardianId}, 30, 40, ${teacherId})`);
    await tx.execute(sql`
      insert into exam_cie_score (org_id, batch_id, term_number, course_id, student_person_id, position, score)
      values (${id}, ${academicBatchId}, 1, ${academicCourseId}, ${guardianId}, 0, 30)`);
    await tx.execute(sql`
      insert into exam_course_lock (org_id, batch_id, term_number, course_id, locked_by_person_id)
      values (${id}, ${academicBatchId}, 1, ${academicCourseId}, ${principalId})`);
    const examResultId = await first(sql`
      insert into exam_result (org_id, batch_id, term_number, state, grading, requested_by_person_id, decided_at)
      values (${id}, ${academicBatchId}, 1, 'published', '{}'::jsonb, ${principalId}, now()) returning id`);
    await tx.execute(sql`
      insert into exam_grade (org_id, result_id, student_person_id, course_id, credits, cie, see, absent, total, grade, point)
      values (${id}, ${examResultId}, ${guardianId}, ${academicCourseId}, 4, 30, 40, false, 70, 'A', 8)`);
    await tx.execute(sql`
      insert into exam_gpa (org_id, result_id, student_person_id, credits, credits_earned, sgpa, cgpa)
      values (${id}, ${examResultId}, ${guardianId}, 4, 4, 8, 8)`);
    // A revaluation that was turned down (closed, so it changes no grade), for the isolation suite.
    await tx.execute(sql`
      insert into exam_reexam (org_id, result_id, student_person_id, course_id, kind, state, old_see, old_total,
        old_grade, old_point, see, absent, total, grade, point, passed, requested_by_person_id,
        marked_by_person_id, marked_at, decided_at)
      values (${id}, ${examResultId}, ${guardianId}, ${academicCourseId}, 'revaluation', 'rejected', 40, 70, 'A', 8,
        40, false, 70, 'A', 8, true, ${principalId}, ${teacherId}, now(), now())`);

    // College attendance: a session on the synthetic batch with the guardian marked, and a condonation.
    const attendanceSessionId = await first(sql`
      insert into course_attendance_session (org_id, batch_id, term_number, section_id, course_id, on_date, period,
        taken_by_person_id)
      values (${id}, ${academicBatchId}, 1, ${academicSectionId}, ${academicCourseId}, '2026-07-06', 1, ${teacherId})
      returning id`);
    await tx.execute(sql`
      insert into course_attendance_mark (org_id, session_id, student_person_id, status)
      values (${id}, ${attendanceSessionId}, ${guardianId}, 'present')`);
    await tx.execute(sql`
      insert into course_attendance_condonation (org_id, batch_id, term_number, course_id, student_person_id,
        basis_points, reason, state, requested_by_person_id, decided_at)
      values (${id}, ${academicBatchId}, 1, ${academicCourseId}, ${guardianId}, 7000, 'Synthetic medical reason',
        'refused', ${teacherId}, now())`);

    // A hall ticket for the guardian on the synthetic batch (its document is a stand-in, never downloaded).
    const hallTicketDocId = await first(sql`
      insert into issued_document (org_id, kind, number, subject_person_id, sha256, storage_key, verification_code)
      values (${id}, 'hall_ticket', ${`SEED-HT-${randomUUID()}`}, ${guardianId}, ${'0'.repeat(64)},
        ${`${id}/documents/seed-${randomUUID()}.pdf`}, ${randomUUID().replaceAll('-', '')}) returning id`);
    await tx.execute(sql`
      insert into exam_hall_ticket (org_id, batch_id, term_number, student_person_id, number, course_ids,
        document_id, issued_by_person_id)
      values (${id}, ${academicBatchId}, 1, ${guardianId}, 'HT-SEED-1', ${`{${academicCourseId}}`}::uuid[],
        ${hallTicketDocId}, ${principalId})`);

    // OBE: a draft outcome set with one PO, a CO on the synthetic course, its mapping and a tag.
    const obeSetId = await first(sql`
      insert into obe_outcome_set (org_id, program_id, version, effective_from, created_by_person_id)
      values (${id}, ${academicProgramId}, 1, '2025-06-01', ${principalId}) returning id`);
    const obePoId = await first(sql`
      insert into obe_outcome (org_id, set_id, kind, code, statement, position)
      values (${id}, ${obeSetId}, 'po', 'PO1', 'Synthetic programme outcome', 1) returning id`);
    const obeCoId = await first(sql`
      insert into obe_course_outcome (org_id, regulation_id, course_id, code, statement, position)
      values (${id}, ${academicRegulationId}, ${academicCourseId}, 'CO1', 'Synthetic course outcome', 1) returning id`);
    await tx.execute(sql`
      insert into obe_co_mapping (org_id, course_outcome_id, outcome_id, level) values (${id}, ${obeCoId}, ${obePoId}, 3)`);
    await tx.execute(sql`
      insert into obe_item_tag (org_id, course_outcome_id, item) values (${id}, ${obeCoId}, 'see')`);

    // Course registration: a window on the synthetic batch, a cap, the guardian's registration.
    const registrationWindowId = await first(sql`
      insert into registration_window (org_id, batch_id, term_number, opens_on, closes_on, min_credits, max_credits)
      values (${id}, ${academicBatchId}, 1, '2025-07-01', '2025-07-15', 4, 24) returning id`);
    await tx.execute(sql`
      insert into registration_cap (org_id, window_id, course_id, seats)
      values (${id}, ${registrationWindowId}, ${academicCourseId}, 60)`);
    const courseRegistrationId = await first(sql`
      insert into course_registration (org_id, window_id, student_person_id, status, credits)
      values (${id}, ${registrationWindowId}, ${guardianId}, 'submitted', 4) returning id`);
    await tx.execute(sql`
      insert into course_registration_item (org_id, registration_id, course_id, credits, elective)
      values (${id}, ${courseRegistrationId}, ${academicCourseId}, 4, false)`);

    // Workflow & Approvals: a step (for a process no module uses, so no test's approvals change),
    // a request on the synthetic registration, one decision.
    await tx.execute(sql`
      insert into approval_step (org_id, process, position, approver_role_key)
      values (${id}, 'synthetic.seed_only', 1, 'principal')`);
    const approvalRequestId = await first(sql`
      insert into approval_request (org_id, process, subject_id, institution_id, campus_id, summary, steps, status, closed_at)
      values (${id}, 'academics.registration', ${courseRegistrationId}, ${inst.id}, ${ca.id}, 'Synthetic registration',
        '[{"role":null,"hours":null,"escalateTo":null}]'::jsonb, 'approved', now())
      returning id`);
    await tx.execute(sql`
      insert into approval_decision (org_id, request_id, step_index, decided_by_person_id, decision)
      values (${id}, ${approvalRequestId}, 0, ${principalId}, 'approve')`);

    // Guardian verification: one check, on the teacher (not the seeded guardian, so tests start
    // with an unverified guardian), from the institution's records.
    await tx.execute(sql`
      insert into consent_guardian_check (org_id, guardian_person_id, outcome, method, checked_by_person_id)
      values (${id}, ${teacherId}, 'verified', 'known_record', ${principalId})`);

    // Rule packs: the school stays on the built-in labour pack (version 1), recorded once.
    await tx.execute(sql`
      insert into rule_pack_adoption (org_id, institution_id, pack, version, from_date, adopted_by_person_id)
      values (${id}, ${inst.id}, 'labour.central', 1, '2026-04-01', ${principalId})`);

    // Case grants (rule book §10.3): the principal, about the guardian, already ended, so no test's
    // permissions change.
    await tx.execute(sql`
      insert into access_case_grant (org_id, grantee_person_id, permission, subject_person_id, reason,
        granted_by_person_id, expires_at, ended_at, ended_by_person_id)
      values (${id}, ${principalId}, 'health.record.read', ${guardianId}, 'Synthetic case for the isolation suite',
        ${teacherId}, now() + interval '1 day', now(), ${teacherId})`);

    // Final settlement: a paid one for the principal (synthetic), so no screen shows it as due.
    await tx.execute(sql`
      insert into payroll_settlement (org_id, institution_id, person_id, last_day, due_on, salary_days,
        salary_net_paise, gratuity_wages_paise, service_months, gratuity_years, gratuity_paise, fixed_term,
        total_paise, state, prepared_by_person_id, paid_on, payment_reference)
      values (${id}, ${inst.id}, ${principalId}, '2025-10-31', '2025-11-03', 0, 0, 1500000, 72, 6, 5192300,
        false, 5192300, 'paid', ${teacherId}, '2025-11-03', 'SYN-SEED')`);

    // Assets (docs/specs/ASSETS.md): a category, location, an asset with its history, stock received.
    const assetCategoryId = await first(sql`
      insert into asset_category (org_id, name) values (${id}, 'Furniture') returning id`);
    const locationId = await first(sql`
      insert into asset_location (org_id, institution_id, name) values (${id}, ${inst.id}, 'Room 5-A') returning id`);
    const assetId = await first(sql`
      insert into asset_item (org_id, institution_id, tag, name, category_id, location_id, cost_paise)
      values (${id}, ${inst.id}, 'AST-0001', 'Synthetic teacher desk', ${assetCategoryId}, ${locationId}, 450000)
      returning id`);
    await tx.execute(sql`
      insert into asset_event (org_id, item_id, kind, to_value, by_person_id)
      values (${id}, ${assetId}, 'added', 'AST-0001', ${principalId})`);
    const stockId = await first(sql`
      insert into stock_item (org_id, institution_id, name, unit, reorder_level)
      values (${id}, ${inst.id}, 'Chalk', 'boxes', 5) returning id`);
    await tx.execute(sql`
      insert into stock_movement (org_id, item_id, direction, quantity, by_person_id)
      values (${id}, ${stockId}, 'in', 20, ${principalId})`);

    // Appraisals (docs/specs/APPRAISALS.md): an open cycle, a criterion, the teacher's review with a self-rating.
    const cycleId = await first(sql`
      insert into appraisal_cycle (org_id, institution_id, name, opens_on, closes_on, state, created_by_person_id)
      values (${id}, ${inst.id}, '2026-27 annual', '2026-11-01', '2027-01-31', 'open', ${principalId}) returning id`);
    const criterionId = await first(sql`
      insert into appraisal_criterion (org_id, cycle_id, position, title) values (${id}, ${cycleId}, 1, 'Teaching')
      returning id`);
    const reviewId = await first(sql`
      insert into appraisal_review (org_id, cycle_id, person_id, reviewer_person_id, state, self_at)
      values (${id}, ${cycleId}, ${teacherId}, ${principalId}, 'review', now()) returning id`);
    await tx.execute(sql`
      insert into appraisal_rating (org_id, review_id, criterion_id, by_role, score)
      values (${id}, ${reviewId}, ${criterionId}, 'self', 4)`);

    // Payroll (docs/specs/PAYROLL.md): the teacher's salary and a June 2026 draft run with their slip.
    const salaryId = await first(sql`
      insert into payroll_salary (org_id, institution_id, person_id, effective_from, basic_paise, hra_paise,
        set_by_person_id)
      values (${id}, ${inst.id}, ${teacherId}, '2026-06-01', 2000000, 800000, ${principalId}) returning id`);
    const runId = await first(sql`
      insert into payroll_run (org_id, institution_id, month, attendance_through, prepared_by_person_id)
      values (${id}, ${inst.id}, '2026-06-01', '2026-06-30', ${principalId}) returning id`);
    await tx.execute(sql`
      insert into payroll_slip (org_id, run_id, person_id, salary_id, snapshot, calendar_days, lop_halves,
        basic_paise, da_paise, hra_paise, conveyance_paise, special_paise, other_paise, gross_paise, pf_paise,
        esi_paise, pt_paise, tds_paise, other_deduction_paise, net_paise, employer_pf_paise, employer_esi_paise)
      values (${id}, ${runId}, ${teacherId}, ${salaryId}, '{"name":"Synthetic Teacher"}'::jsonb, 30, 0,
        2000000, 0, 800000, 0, 0, 0, 2800000, 180000, 0, 20000, 0, 0, 2600000, 180000, 0)`);
    // Arrears on that draft slip for May (synthetic), for the isolation suite.
    await tx.execute(sql`
      insert into payroll_arrear (org_id, run_id, person_id, for_month, salary_id, gross_paise, pf_paise,
        employer_pf_paise, esi_paise, employer_esi_paise)
      values (${id}, ${runId}, ${teacherId}, '2026-05-01', ${salaryId}, 100, 0, 0, 0, 0)`);

    // A TDS challan for May 2026 (synthetic), for the isolation suite.
    await tx.execute(sql`
      insert into payroll_tds_challan (org_id, institution_id, month, bsr_code, challan_serial, deposited_on,
        amount_paise, recorded_by_person_id)
      values (${id}, ${inst.id}, '2026-05-01', '0510001', '00001', '2026-06-07', 100, ${principalId})`);

    // An online application form (docs/specs/ONLINE_APPLICATIONS.md).
    const admissionFormId = await first(sql`
      insert into school_admission_form (org_id, institution_id, year_label, slug, title, class_ids,
        created_by_person_id)
      values (${id}, ${inst.id}, '2027-28', ${`synthetic-${randomInt(1e9)}`}, 'Synthetic admissions',
        ${`{${classId}}`}::uuid[], ${principalId})
      returning id`);

    // Homework and the class diary (docs/specs/HOMEWORK.md): set, a done tick and a diary entry.
    const homeworkId = await first(sql`
      insert into school_homework (org_id, institution_id, subject_id, title, set_on, due_on, set_by_person_id)
      values (${id}, ${inst.id}, ${subjectId}, 'Exercise 3.1', app_today(), app_today() + 1, ${teacherId})
      returning id`);
    await tx.execute(sql`
      insert into school_homework_section (org_id, homework_id, section_id) values (${id}, ${homeworkId}, ${sectionId})`);
    await tx.execute(sql`
      insert into school_homework_file (org_id, homework_id, file_id, position) values (${id}, ${homeworkId}, ${docFileId}, 1)`);
    await tx.execute(sql`
      insert into school_homework_done (org_id, homework_id, student_person_id, marked_by_person_id)
      values (${id}, ${homeworkId}, ${studentId}, ${guardianId})`);
    await tx.execute(sql`
      insert into school_diary_entry (org_id, section_id, on_date, subject_id, body, written_by_person_id)
      values (${id}, ${sectionId}, app_today(), ${subjectId}, 'Fractions: adding unlike denominators.', ${teacherId})`);

    // Staff leave (docs/specs/STAFF_LEAVE.md): a type, a pending request and an opening balance.
    const leaveTypeId = await first(sql`
      insert into staff_leave_type (org_id, code, name, paid, days_per_year, since_year)
      values (${id}, 'CL', 'Casual leave', true, 12, 2026) returning id`);
    await tx.execute(sql`
      insert into staff_leave_request (org_id, person_id, institution_id, type_id, from_date, to_date, days, reason,
        requested_by_person_id)
      values (${id}, ${teacherId}, ${inst.id}, ${leaveTypeId}, '2026-12-01', '2026-12-01', 1, 'Family function',
        ${teacherId})`);
    await tx.execute(sql`
      insert into staff_leave_adjustment (org_id, person_id, type_id, leave_year, days, reason, by_person_id)
      values (${id}, ${teacherId}, ${leaveTypeId}, 2026, 2, 'Opening balance', ${principalId})`);

    // Owner-defined fields and a sensitive grant waiting for a second owner (decision 0020).
    const fieldId = await first(sql`
      insert into custom_field (org_id, entity, key, label, type)
      values (${id}, 'student', 'house', 'House', 'text') returning id`);
    await tx.execute(sql`
      insert into custom_field_value (org_id, field_id, record_id, value)
      values (${id}, ${fieldId}, ${studentId}, '"Synthetic Blue"')`);
    await tx.execute(sql`
      insert into role_grant_request (org_id, role_id, permission, requested_by_person_id)
      select ${id}, r.id, 'finance.refund.approve', ${principalId} from role r
      where r.org_id = ${id} and r.key = 'principal'`);

    // Fees: a head, a published plan with one instalment, an invoice paid by one cash payment with
    // its receipt, plus a concession, a refund, a reversal request and a day close.
    const headId = await first(sql`
      insert into fee_head (org_id, institution_id, code, name) values (${id}, ${inst.id}, 'TUITION', 'Tuition')
      returning id`);
    const planId = await first(sql`
      insert into fee_plan (org_id, family_id, institution_id, name, group_ids, state, created_by_person_id)
      values (${id}, uuidv7(), ${inst.id}, 'Class 5 fees', ${`{${sectionId}}`}::uuid[], 'published', ${principalId})
      returning id`);
    await tx.execute(sql`
      insert into fee_plan_line (org_id, plan_id, head_id, amount_paise) values (${id}, ${planId}, ${headId}, 1200000)`);
    await tx.execute(sql`
      insert into fee_instalment (org_id, plan_id, seq, label, due_on, share_bp)
      values (${id}, ${planId}, 1, 'Annual', '2026-06-10', 10000)`);
    const invoiceId = await first(sql`
      insert into fee_invoice (org_id, legal_entity_id, institution_id, student_person_id, plan_id, plan_family_id,
        instalment_seq, label, issued_on, due_on, state, total_paise, paid_paise)
      select ${id}, ${le.id}, ${inst.id}, ${studentId}, id, family_id, 1, 'Annual', '2026-05-01', '2026-06-10', 'paid',
        1200000, 1200000 from fee_plan where org_id = ${id} and id = ${planId}
      returning id`);
    await tx.execute(sql`
      insert into fee_invoice_line (org_id, invoice_id, head_id, kind, amount_paise)
      values (${id}, ${invoiceId}, ${headId}, 'charge', 1200000)`);
    await tx.execute(sql`
      insert into fee_concession (org_id, student_person_id, kind, value, valid_during, reason, requested_by_person_id)
      values (${id}, ${studentId}, 'percent', 1000, daterange('2026-04-01', '2027-04-01'), 'Sibling', ${teacherId})`);
    const paymentId = await first(sql`
      insert into fee_payment (org_id, legal_entity_id, institution_id, student_person_id, amount_paise, method, state,
        collected_by_person_id, collected_on, succeeded_at)
      values (${id}, ${le.id}, ${inst.id}, ${studentId}, 1200000, 'cash', 'succeeded', ${teacherId}, '2026-05-02', now())
      returning id`);
    await tx.execute(sql`
      insert into fee_allocation (org_id, payment_id, invoice_id, amount_paise) values (${id}, ${paymentId}, ${invoiceId}, 1200000)`);
    await tx.execute(sql`
      insert into fee_receipt_counter (org_id, legal_entity_id, financial_year, next_number) values (${id}, ${le.id}, '2026-27', 2)`);
    await tx.execute(sql`
      insert into fee_receipt (org_id, legal_entity_id, financial_year, number, kind, payment_id, student_person_id,
        amount_paise, snapshot)
      values (${id}, ${le.id}, '2026-27', 1, 'receipt', ${paymentId}, ${studentId}, 1200000, '{}')`);
    await tx.execute(sql`
      insert into fee_refund (org_id, payment_id, amount_paise, reason, requested_by_person_id)
      values (${id}, ${paymentId}, 100000, 'Paid twice', ${teacherId})`);
    await tx.execute(sql`
      insert into fee_reversal (org_id, payment_id, reason, requested_by_person_id)
      values (${id}, ${paymentId}, 'Entered against the wrong student', ${teacherId})`);
    await tx.execute(sql`
      insert into fee_day_close (org_id, institution_id, cashier_person_id, on_date, expected_cash_paise, counted_cash_paise)
      values (${id}, ${inst.id}, ${teacherId}, '2026-05-02', 1200000, 1200000)`);
    // Fees collected for others (a board's share, paid on), and a voluntary donation.
    const payeeId = await first(sql`
      insert into fee_payee (org_id, institution_id, kind, name, short_name)
      values (${id}, ${inst.id}, 'board', 'Synthetic Board of Education', 'SBE') returning id`);
    await tx.execute(sql`
      insert into fee_remittance (org_id, institution_id, payee_id, period_label, amount_paise, paid_on, reference,
        recorded_by_person_id)
      values (${id}, ${inst.id}, ${payeeId}, '2026-27', 100000, '2026-05-03', 'UTR-SYNTH-0001', ${teacherId})`);
    await tx.execute(sql`
      insert into donation_counter (org_id, legal_entity_id, financial_year, next_number)
      values (${id}, ${le.id}, '2026-27', 2)`);
    await tx.execute(sql`
      insert into donation (org_id, legal_entity_id, institution_id, financial_year, number, donor_kind, donor_name,
        fund, amount_paise, method, received_on, recorded_by_person_id)
      values (${id}, ${le.id}, ${inst.id}, '2026-27', 1, 'organisation', 'Synthetic Alumni Association',
        'Library fund', 5000000, 'cash', '2026-05-04', ${teacherId})`);

    // Admissions and certificates: an enquiry with its first event, seats, a counter and a TC request.
    const applicationId = await first(sql`
      insert into school_application (org_id, institution_id, year_label, class_id, source, child_name,
        guardian_name, guardian_phone, created_by_person_id)
      values (${id}, ${inst.id}, '2027-28', ${classId}, 'walk_in', 'Synthetic Applicant', 'Synthetic Parent',
        ${syntheticPhone()}, ${principalId})
      returning id`);
    await tx.execute(sql`
      insert into school_application_event (org_id, application_id, to_state, actor_person_id)
      values (${id}, ${applicationId}, 'enquiry', ${principalId})`);
    await tx.execute(sql`
      insert into school_application_document (org_id, application_id, kind, title, file_id, uploaded_by_person_id)
      values (${id}, ${applicationId}, 'birth_certificate', 'Birth certificate', ${docFileId}, ${principalId})`);
    // The lead's work: a call, a follow-up, a form link sent, and a bulk upload it could have come from.
    await tx.execute(sql`
      insert into school_admission_activity (org_id, application_id, kind, outcome, note, by_person_id)
      values (${id}, ${applicationId}, 'call', 'interested', 'Wants a school visit', ${principalId})`);
    await tx.execute(sql`
      insert into school_admission_follow_up (org_id, application_id, due_on, purpose, assigned_to_person_id,
        created_by_person_id)
      values (${id}, ${applicationId}, app_today() + 2, 'Invite for a school visit', ${principalId}, ${principalId})`);
    await tx.execute(sql`
      insert into school_admission_invite (org_id, institution_id, form_id, application_id, purpose, channel,
        token_hash, expires_at, sent_by_person_id)
      values (${id}, ${inst.id}, ${admissionFormId}, ${applicationId}, 'apply', 'link',
        decode(md5(random()::text), 'hex'), now() + interval '14 days', ${principalId})`);
    await tx.execute(sql`
      insert into school_admission_import (org_id, institution_id, year_label, file_name, source, total_rows,
        imported_rows, skipped_rows, created_by_person_id)
      values (${id}, ${inst.id}, '2027-28', 'synthetic-leads.xlsx', 'other', 0, 0, 0, ${principalId})`);
    await tx.execute(sql`
      insert into school_admission_seat (org_id, institution_id, year_label, class_id, category, seats)
      values (${id}, ${inst.id}, '2027-28', ${classId}, 'general', 40)`);
    // An undecided seat draw from an earlier year, so it never blocks a new one.
    await tx.execute(sql`
      insert into school_admission_draw (org_id, institution_id, year_label, class_id, category, method, sibling_first,
        seed, pool, ranked, seats_free, drawn_by_person_id)
      values (${id}, ${inst.id}, '2025-26', ${classId}, 'general', 'lottery', false, 'synthetic-seed', '[]'::jsonb,
        array[${applicationId}]::uuid[], 0, ${principalId})`);
    // The principal looks at their own institution.
    await tx.execute(sql`
      insert into view_preference (org_id, person_id, level, node_ids)
      values (${id}, ${principalId}, 'institution', array[${inst.id}]::uuid[])`);
    await tx.execute(sql`
      insert into school_number_counter (org_id, institution_id, kind, year_label) values (${id}, ${inst.id}, 'tc', '2026-27')`);
    await tx.execute(sql`
      insert into school_certificate_request (org_id, institution_id, student_person_id, kind, requested_by_person_id)
      values (${id}, ${inst.id}, ${studentId}, 'bonafide', ${principalId})`);

    // Exams and rollover: a published exam with a paper, a mark, a change request, a remark and a
    // result; a section plan and a rollover into a next year.
    const examId = await first(sql`
      insert into school_exam (org_id, institution_id, year_id, name, class_ids, state, grade_scheme, created_by_person_id,
        published_at)
      values (${id}, ${inst.id}, ${yearId}, 'Term 1', ${`{${classId}}`}::uuid[], 'published', 'cbse-8pt@2026', ${principalId}, now())
      returning id`);
    const paperId = await first(sql`
      insert into school_exam_paper (org_id, exam_id, class_id, subject_id, max_marks)
      values (${id}, ${examId}, ${classId}, ${subjectId}, 80) returning id`);
    await tx.execute(sql`
      insert into school_exam_mark (org_id, paper_id, student_person_id, value, entered_by_person_id)
      values (${id}, ${paperId}, ${studentId}, 72.5, ${teacherId})`);
    await tx.execute(sql`
      insert into school_exam_mark_change (org_id, paper_id, student_person_id, new_value, reason, requested_by_person_id)
      values (${id}, ${paperId}, ${studentId}, 74, 'Totalling error', ${teacherId})`);
    await tx.execute(sql`
      insert into school_exam_remark (org_id, exam_id, student_person_id, remark, written_by_person_id)
      values (${id}, ${examId}, ${studentId}, 'Works steadily.', ${teacherId})`);
    await tx.execute(sql`
      insert into school_exam_result (org_id, exam_id, student_person_id, class_id, section_id, subjects, marks, max_marks,
        percent, grade, grade_scheme)
      values (${id}, ${examId}, ${studentId}, ${classId}, ${sectionId}, '[]', 72.5, 80, 90.62, 'A2', 'cbse-8pt@2026')`);
    // Report card and the year's final result: a co-scholastic area graded A, and a published plan
    // weighting the exam 100% with its frozen result.
    const areaId = await first(sql`
      insert into school_coscholastic_area (org_id, institution_id, name) values (${id}, ${inst.id}, 'Art Education')
      returning id`);
    await tx.execute(sql`
      insert into school_exam_coscholastic (org_id, exam_id, student_person_id, area_id, grade, entered_by_person_id)
      values (${id}, ${examId}, ${studentId}, ${areaId}, 'A', ${teacherId})`);
    const resultPlanId = await first(sql`
      insert into school_result_plan (org_id, institution_id, year_id, name, class_ids, state, grade_scheme,
        created_by_person_id, published_by_person_id, published_at)
      values (${id}, ${inst.id}, ${yearId}, 'Final result', ${`{${classId}}`}::uuid[], 'published', 'cbse-8pt@2026',
        ${principalId}, ${principalId}, now()) returning id`);
    await tx.execute(sql`
      insert into school_result_plan_exam (org_id, plan_id, exam_id, weight_bp) values (${id}, ${resultPlanId}, ${examId}, 10000)`);
    await tx.execute(sql`
      insert into school_final_result (org_id, plan_id, student_person_id, class_id, section_id, subjects, percent, grade,
        grade_scheme)
      values (${id}, ${resultPlanId}, ${studentId}, ${classId}, ${sectionId}, '[]', 90.62, 'A2', 'cbse-8pt@2026')`);
    const nextYearId = await first(sql`
      insert into school_year (org_id, institution_id, label, valid_during, status)
      values (${id}, ${inst.id}, '2027-28', daterange('2027-04-01', '2028-04-01'), 'planned') returning id`);
    await tx.execute(sql`
      insert into school_section_plan (org_id, to_year_id, class_id, updated_by_person_id)
      values (${id}, ${nextYearId}, ${classId}, ${principalId})`);
    await tx.execute(sql`
      insert into school_rollover (org_id, institution_id, from_year_id, to_year_id, rows, committed_by_person_id)
      values (${id}, ${inst.id}, ${yearId}, ${nextYearId}, '[]', ${principalId})`);

    // Verse AI: one logged question, and an action it prepared (decision 0021).
    const verseRequestId = await first(sql`
      insert into verse_request (org_id, person_id, institution_id, question, model, outcome, answer)
      values (${id}, ${principalId}, ${inst.id}, 'Which classes have not marked attendance?', 'local', 'answered', 'All marked.')
      returning id`);
    await tx.execute(sql`
      insert into verse_action (org_id, request_id, person_id, institution_id, tool, input, preview)
      values (${id}, ${verseRequestId}, ${principalId}, ${inst.id}, 'library.loan.return',
        '{"accessionNo":"ACC-0001"}', '{"title":"Return Synthetic Stories","lines":[],"confirm":"Return","tone":"normal"}')`);

    // Notices: one sent notice with an English version, and the guardian's language.
    const noticeId = await first(sql`
      insert into notice (org_id, institution_id, kind, audience, state, created_by_person_id, send_at, sent_at)
      values (${id}, ${inst.id}, 'notice', '{"type": "school"}', 'sent', ${principalId}, now(), now())
      returning id`);
    await tx.execute(sql`
      insert into notice_version (org_id, notice_id, language, title, body)
      values (${id}, ${noticeId}, 'en', 'Synthetic notice', 'School reopens Monday.')`);
    await tx.execute(sql`
      insert into communication_preference (org_id, person_id, language) values (${id}, ${guardianId}, 'kn')`);

    // Attendance: one submitted day with an absence, a conflict, leave, a holiday and the rest.
    const eventId = await first(sql`
      insert into school_attendance_event (org_id, event_id, kind, section_id, on_date, actor_person_id, marks, occurred_at)
      values (${id}, uuidv7(), 'submit', ${sectionId}, '2026-07-01', ${teacherId},
        ${JSON.stringify([{ personId: studentId, status: 'absent' }])}::jsonb, now())
      returning event_id as id`);
    await tx.execute(sql`
      insert into school_attendance_session (org_id, section_id, on_date, first_event_id, submitted_by_person_id)
      values (${id}, ${sectionId}, '2026-07-01', ${eventId}, ${teacherId})`);
    await tx.execute(sql`
      insert into school_attendance_day (org_id, person_id, on_date, section_id, status, source_event_id)
      values (${id}, ${studentId}, '2026-07-01', ${sectionId}, 'absent', ${eventId})`);
    await tx.execute(sql`
      insert into school_attendance_conflict (org_id, section_id, on_date, person_id, current_status,
        incoming_status, incoming_event_id)
      values (${id}, ${sectionId}, '2026-07-01', ${studentId}, 'absent', 'present', ${eventId})`);
    await tx.execute(sql`
      insert into school_attendance_settings (org_id, institution_id) values (${id}, ${inst.id})`);
    await tx.execute(sql`
      insert into school_holiday (org_id, institution_id, on_date, name, declared_by_person_id)
      values (${id}, ${inst.id}, '2026-08-15', 'Independence Day', ${principalId})`);
    await tx.execute(sql`
      insert into school_leave_request (org_id, student_person_id, requested_by_person_id, kind, valid_during, reason)
      values (${id}, ${studentId}, ${guardianId}, 'medical', daterange('2026-07-02', '2026-07-04'), 'Fever')`);
    await tx.execute(sql`
      insert into school_attendance_substitute (org_id, section_id, on_date, person_id, granted_by_person_id)
      values (${id}, ${sectionId}, '2026-07-02', ${principalId}, ${principalId})`);
    await tx.execute(sql`
      insert into school_attendance_notice (org_id, student_person_id, year_id, percent, message_ids, sent_by_person_id)
      values (${id}, ${studentId}, ${yearId}, 70.5, ${`{${message?.id}}`}::uuid[], ${principalId})`);
    await tx.execute(sql`
      insert into school_condonation_case (org_id, student_person_id, year_id, percent, reason, deadline,
        opened_by_person_id)
      values (${id}, ${studentId}, ${yearId}, 70.5, 'Hospitalised for two weeks', '2027-01-31', ${principalId})`);

    // Transport: a bus with its fitness certificate, a stop, and a route through it (Milestone 18).
    const busId = await first(sql`
      insert into transport_vehicle (org_id, campus_id, registration, kind, seats)
      values (${id}, ${ca.id}, 'TS09AB1234', 'bus', 40) returning id`);
    await tx.execute(sql`
      insert into transport_vehicle_document (org_id, vehicle_id, kind, valid_until, recorded_by_person_id)
      values (${id}, ${busId}, 'fitness', '2027-03-31', ${principalId})`);
    const stopId = await first(sql`
      insert into transport_stop (org_id, campus_id, name, fare_zone)
      values (${id}, ${ca.id}, 'Synthetic Nagar', 1) returning id`);
    const routeId = await first(sql`
      insert into transport_route (org_id, campus_id, name, direction, vehicle_id)
      values (${id}, ${ca.id}, 'Route 1', 'pickup', ${busId}) returning id`);
    await tx.execute(sql`
      insert into transport_route_stop (org_id, route_id, seq, stop_id, planned_at)
      values (${id}, ${routeId}, 1, ${stopId}, '07:30')`);
    await tx.execute(sql`
      insert into transport_fare_zone (org_id, campus_id, number) values (${id}, ${ca.id}, 1)`);
    await tx.execute(sql`
      insert into transport_assignment (org_id, person_id, route_id, direction, stop_id, valid_during,
        created_by_person_id)
      values (${id}, ${studentId}, ${routeId}, 'pickup', ${stopId}, daterange('2026-06-01', NULL), ${principalId})`);
    // A past trip, cleared, with one boarding mark.
    const tripId = await first(sql`
      insert into transport_trip (org_id, route_id, direction, trip_date, vehicle_id, started_by_person_id,
        started_at, ended_by_person_id, ended_at, check_outcome)
      values (${id}, ${routeId}, 'pickup', '2026-06-01', ${busId}, ${principalId}, '2026-06-01T01:45:00Z',
        ${principalId}, '2026-06-01T02:30:00Z', 'empty') returning id`);
    await tx.execute(sql`
      insert into transport_boarding_event (org_id, id, trip_id, person_id, kind, stop_id, occurred_at,
        by_person_id, device_id)
      values (${id}, uuidv7(), ${tripId}, ${studentId}, 'boarded', ${stopId}, '2026-06-01T02:00:00Z',
        ${principalId}, 'seed')`);
    await tx.execute(sql`
      insert into transport_skip (org_id, person_id, trip_date, direction, requested_by_person_id)
      values (${id}, ${studentId}, '2026-06-02', 'pickup', ${guardianId})`);
    await tx.execute(sql`
      insert into transport_position (org_id, trip_id, at, latitude, longitude, speed_kmh)
      values (${id}, ${tripId}, '2026-06-01T02:05:00Z', 17.385, 78.4867, 32)`);

    return {
      orgId: id,
      legalEntityId: le.id,
      campusId: ca.id,
      institutionId: inst.id,
      principalId,
      teacherId,
      studentId,
      guardianId,
    };
  });
}

/** Test helper: adds a permission to one of the seeded roles ('principal' or 'parent'). */
export async function grantPermission(
  db: Db,
  orgId: string,
  roleKey: 'principal' | 'parent',
  permission: string,
  relation: 'self' | 'guardian' | null = null,
): Promise<void> {
  await withTenant(db, orgId, (tx) =>
    tx.execute(sql`
      insert into role_grant (org_id, role_id, permission, relation)
      select org_id, id, ${permission}, ${relation} from role
      where org_id = ${orgId} and key = ${roleKey}
      on conflict do nothing`),
  );
}

/** Test helper: a person holding an organisation-wide role with exactly these permissions. */
export async function seedAdmin(db: Db, orgId: string, permissions: string[]): Promise<string> {
  return withTenant(db, orgId, async (tx) => {
    const [p] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (${orgId}, 'Synthetic Admin') returning id::text`);
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into role (org_id, key, name) values (${orgId}, ${`admin_${randomInt(1e9)}`}, 'Admin')
      returning id::text`);
    if (!p || !r) throw new Error('seedAdmin: insert returned no row');
    for (const permission of permissions) {
      await tx.execute(sql`
        insert into role_grant (org_id, role_id, permission) values (${orgId}, ${r.id}, ${permission})`);
    }
    await tx.execute(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      values (${orgId}, ${p.id}, ${r.id}, 'organisation', ${orgId})`);
    return p.id;
  });
}

/** Valid-format Indian mobile that belongs to no one: synthetic data only. */
export const syntheticPhone = () => `+919${randomInt(100_000_000, 999_999_999)}`;

async function newId(db: Db): Promise<string> {
  const [row] = await db.execute<{ id: string }>(sql`select uuidv7()::text as id`);
  if (!row) throw new Error('uuidv7() returned no row');
  return row.id;
}
