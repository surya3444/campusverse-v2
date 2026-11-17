-- Milestone 19, step 3 (docs/specs/TIMETABLE.md): parents see their own child's timetable.
INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'school.timetable.read', 'guardian' FROM role r
WHERE r.key = 'parent'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
