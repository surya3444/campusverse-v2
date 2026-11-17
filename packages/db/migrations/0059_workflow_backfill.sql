-- Bills and course registrations already waiting move onto the approval engine with one step:
-- anyone holding the process's approval permission, which is how they were decided before.
INSERT INTO approval_request (org_id, process, subject_id, institution_id, campus_id, amount_paise, summary,
  requested_by_person_id, steps, created_at, step_since)
SELECT b.org_id, 'expenses.bill', b.id, b.institution_id, i.campus_id, b.amount_paise,
  left(coalesce(v.name, b.payee) || ' · ' || coalesce(nullif(btrim(b.bill_no), ''), b.description), 200),
  b.recorded_by_person_id, '[{"role":null,"hours":null,"escalateTo":null}]'::jsonb, b.created_at, b.created_at
FROM expense_bill b
JOIN institution i ON i.org_id = b.org_id AND i.id = b.institution_id
LEFT JOIN expense_vendor v ON v.org_id = b.org_id AND v.id = b.vendor_id
WHERE b.state = 'submitted'
  AND NOT EXISTS (SELECT 1 FROM approval_request r WHERE r.org_id = b.org_id AND r.process = 'expenses.bill'
    AND r.subject_id = b.id AND r.status = 'pending');

INSERT INTO approval_request (org_id, process, subject_id, institution_id, campus_id, summary,
  requested_by_person_id, steps, created_at, step_since)
SELECT c.org_id, 'academics.registration', c.id, p.institution_id, i.campus_id,
  left(pe.legal_name || ' · ' || p.code || ' ' || ab.label || ' · ' || c.credits || ' credits', 200),
  c.submitted_by_person_id, '[{"role":null,"hours":null,"escalateTo":null}]'::jsonb, c.submitted_at, c.submitted_at
FROM course_registration c
JOIN registration_window w ON w.org_id = c.org_id AND w.id = c.window_id
JOIN academic_batch ab ON ab.org_id = w.org_id AND ab.id = w.batch_id
JOIN academic_program p ON p.org_id = ab.org_id AND p.id = ab.program_id
JOIN institution i ON i.org_id = p.org_id AND i.id = p.institution_id
JOIN person pe ON pe.org_id = c.org_id AND pe.id = c.student_person_id
WHERE c.status = 'submitted'
  AND NOT EXISTS (SELECT 1 FROM approval_request r WHERE r.org_id = c.org_id AND r.process = 'academics.registration'
    AND r.subject_id = c.id AND r.status = 'pending');
