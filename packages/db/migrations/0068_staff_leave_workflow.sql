-- Staff leave moves onto the approval engine (rule book §12.4 decision 6). Requests already
-- waiting get one step: anyone holding staff.leave.approve, which is how they were decided before.
-- The person on leave is the requester, so the engine never lets them decide their own leave.
INSERT INTO approval_request (org_id, process, subject_id, institution_id, campus_id, summary,
  requested_by_person_id, steps, created_at, step_since)
SELECT r.org_id, 'staff.leave', r.id, r.institution_id, i.campus_id,
  left(p.legal_name || ' · ' || t.code || ' · ' || r.from_date::text ||
    CASE WHEN r.to_date = r.from_date THEN '' ELSE ' to ' || r.to_date::text END ||
    ' · ' || trim(trailing '.' from trim(trailing '0' from r.days::text)) || CASE WHEN r.days = 1 THEN ' day' ELSE ' days' END, 200),
  r.person_id, '[{"role":null,"hours":null,"escalateTo":null}]'::jsonb, r.requested_at, r.requested_at
FROM staff_leave_request r
JOIN institution i ON i.org_id = r.org_id AND i.id = r.institution_id
JOIN person p ON p.org_id = r.org_id AND p.id = r.person_id
JOIN staff_leave_type t ON t.org_id = r.org_id AND t.id = r.type_id
WHERE r.state = 'pending'
  AND NOT EXISTS (SELECT 1 FROM approval_request a WHERE a.org_id = r.org_id AND a.process = 'staff.leave'
    AND a.subject_id = r.id AND a.status = 'pending');
