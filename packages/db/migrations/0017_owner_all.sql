-- The owner role holds every staff permission (decision 0020). 0016 copied the school
-- administrator's grants; this adds the one they don't hold.
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'school.attendance.leave_request' FROM role r WHERE r.key = 'owner'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
