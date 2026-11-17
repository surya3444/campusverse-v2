-- Notices move onto the approval engine (rule book §12.4 decision 6). Drafts already waiting (not
-- urgent ones, which a named role sends without approval) get one step: anyone holding
-- communications.notice.approve, which is how they were approved before. No requester is
-- recorded, so a principal may still approve their own notice.
INSERT INTO approval_request (org_id, process, subject_id, institution_id, campus_id, summary,
  requested_by_person_id, steps, created_at, step_since)
SELECT n.org_id, 'communications.notice', n.id, n.institution_id, i.campus_id, left(v.title, 200),
  NULL, '[{"role":null,"hours":null,"escalateTo":null}]'::jsonb, n.created_at, n.created_at
FROM notice n
JOIN institution i ON i.org_id = n.org_id AND i.id = n.institution_id
JOIN notice_version v ON v.org_id = n.org_id AND v.notice_id = n.id AND v.language = 'en'
WHERE n.state = 'draft' AND n.kind <> 'urgent'
  AND NOT EXISTS (SELECT 1 FROM approval_request a WHERE a.org_id = n.org_id AND a.process = 'communications.notice'
    AND a.subject_id = n.id AND a.status = 'pending');
