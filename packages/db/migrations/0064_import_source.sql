-- Campus Core › Data Import (rule book §13 Campus Core, §17 P0 item 16): where an import came
-- from. 'xlsx' is the template; 'v1' is an export of the earlier Campusverse product, converted to
-- the same rows so its tenants move across with the same checks, dry run and undo.
ALTER TABLE import_batch
  ADD COLUMN source text NOT NULL DEFAULT 'xlsx' CHECK (source IN ('xlsx', 'v1'));
