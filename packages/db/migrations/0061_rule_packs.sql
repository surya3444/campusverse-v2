-- Campus Core › Rule Packs (rule book §15.1, §12.4 decision 11, P0 item 5): regulation as data.
-- Version 1 of each pack is built into packages/rules. Later versions are drafted by Campusverse
-- staff, tested, released by a second staff member, then switched on by each institution from a
-- date. A new circular is a pack version, not a release. Owned by platform/rulepacks.

-- The catalogue, global like the rest of control: no school data here.
CREATE TABLE control.rule_pack_version (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pack text NOT NULL CHECK (pack ~ '^[a-z]+\.[A-Za-z_]+$'),
  version integer NOT NULL CHECK (version >= 2),
  effective_from date NOT NULL,
  payload jsonb NOT NULL,
  sources jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) >= 1),
  tests jsonb NOT NULL CHECK (jsonb_typeof(tests) = 'array' AND jsonb_array_length(tests) >= 1),
  notes text NOT NULL CHECK (length(btrim(notes)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'released')),
  drafted_by uuid NOT NULL REFERENCES control.staff (id),
  drafted_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid REFERENCES control.staff (id),
  released_at timestamptz,
  UNIQUE (pack, version),
  CHECK ((status = 'released') = (released_at IS NOT NULL AND released_by IS NOT NULL)),
  -- Reviewed: the person who releases is not the person who drafted.
  CHECK (released_by IS NULL OR released_by <> drafted_by)
);

-- A released version never changes.
CREATE FUNCTION control.rule_pack_released_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'released' THEN
    RAISE EXCEPTION 'rule pack version is released' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER frozen BEFORE UPDATE OR DELETE ON control.rule_pack_version
  FOR EACH ROW EXECUTE FUNCTION control.rule_pack_released_frozen();

GRANT SELECT, INSERT, UPDATE, DELETE ON control.rule_pack_version TO cv_app;

-- Which version an institution follows from a date. Append-only: switching back is a new row.
CREATE TABLE rule_pack_adoption (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  pack text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  from_date date NOT NULL,
  adopted_by_person_id uuid NOT NULL,
  adopted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, adopted_by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX rule_pack_adoption_lookup_idx
  ON rule_pack_adoption (org_id, institution_id, pack, from_date DESC, id DESC);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON rule_pack_adoption
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE rule_pack_adoption ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_pack_adoption FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rule_pack_adoption
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT ON rule_pack_adoption TO cv_app;

-- Who switches on a new version (also in SCHOOL_ROLES and the access catalogue).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('platform.rules.read'), ('platform.rules.adopt')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
