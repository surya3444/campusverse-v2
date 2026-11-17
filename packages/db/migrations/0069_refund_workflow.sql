-- Fee refunds move onto the approval engine (rule book §12.4 decision 6; §14.4 counts refunds as
-- sensitive). Refunds already waiting get one step: anyone holding finance.refund.approve, which
-- is how they were decided before.
INSERT INTO approval_request (org_id, process, subject_id, institution_id, campus_id, amount_paise, summary,
  requested_by_person_id, steps, created_at, step_since)
SELECT f.org_id, 'finance.refund', f.id, p.institution_id, i.campus_id, f.amount_paise,
  left(s.legal_name || ' · refund · ₹' || to_char(f.amount_paise / 100.0, 'FM99999999990.00'), 200),
  f.requested_by_person_id, '[{"role":null,"hours":null,"escalateTo":null}]'::jsonb, f.created_at, f.created_at
FROM fee_refund f
JOIN fee_payment p ON p.org_id = f.org_id AND p.id = f.payment_id
JOIN institution i ON i.org_id = p.org_id AND i.id = p.institution_id
JOIN person s ON s.org_id = p.org_id AND s.id = p.student_person_id
WHERE f.state = 'requested'
  AND NOT EXISTS (SELECT 1 FROM approval_request a WHERE a.org_id = f.org_id AND a.process = 'finance.refund'
    AND a.subject_id = f.id AND a.status = 'pending');
