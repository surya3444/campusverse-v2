-- Raising an SOS is allowed for every staff role at its scope, not only "about oneself": the
-- screens list plain grants, and 0080's 'self' relation hid the SOS button. Same holders, plain grant.
INSERT INTO role_grant (org_id, role_id, permission)
SELECT org_id, role_id, 'health.emergency.raise' FROM role_grant
WHERE permission = 'health.emergency.raise' AND relation = 'self'
ON CONFLICT DO NOTHING;

DELETE FROM role_grant WHERE permission = 'health.emergency.raise' AND relation = 'self';

UPDATE organisation SET permission_version = permission_version + 1;
