-- Government Reports for schools (rule book §13.11): UDISE+ readiness. Owned by school/returns
-- (no tables). Permissions (also in SCHOOL_ROLES and the access catalogue).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'school.returns.read' FROM role r WHERE r.key IN ('owner', 'school_admin', 'principal', 'office')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
