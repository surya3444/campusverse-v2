-- Development and CI only. Test and production roles come from Terraform, with passwords in Secrets Manager.
-- cv_migrator owns the schema and runs migrations. cv_app is the application login: owns nothing, never bypasses RLS.
-- The migration role may bypass RLS so migrations can backfill every tenant. The app role never can.
CREATE ROLE cv_migrator LOGIN PASSWORD 'cv_migrator' BYPASSRLS;
CREATE ROLE cv_app LOGIN PASSWORD 'cv_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

ALTER SCHEMA public OWNER TO cv_migrator;
GRANT CREATE ON DATABASE campusverse TO cv_migrator;
