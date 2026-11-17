-- Assets and inventory, step 1 (docs/specs/ASSETS.md). Owned by shared/assets.

CREATE TABLE asset_category (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, id)
);
CREATE UNIQUE INDEX asset_category_name ON asset_category (org_id, lower(btrim(name)));

CREATE TABLE asset_location (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);
CREATE UNIQUE INDEX asset_location_name ON asset_location (org_id, institution_id, lower(btrim(name)));

CREATE TABLE asset_item (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  tag text NOT NULL CHECK (tag ~ '^[A-Za-z0-9/-]{1,20}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  category_id uuid NOT NULL,
  location_id uuid,
  custodian_person_id uuid,
  condition text NOT NULL DEFAULT 'good' CHECK (condition IN ('good', 'needs_repair', 'broken')),
  purchased_on date,
  cost_paise bigint CHECK (cost_paise >= 0),
  vendor text NOT NULL DEFAULT '' CHECK (length(vendor) <= 200),
  serial_no text NOT NULL DEFAULT '' CHECK (length(serial_no) <= 100),
  warranty_until date,
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  disposed_on date,
  disposed_reason text CHECK (length(disposed_reason) BETWEEN 3 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, category_id) REFERENCES asset_category (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES asset_location (org_id, id),
  FOREIGN KEY (org_id, custodian_person_id) REFERENCES person (org_id, id),
  CHECK ((disposed_on IS NULL) = (disposed_reason IS NULL))
);
CREATE UNIQUE INDEX asset_item_tag ON asset_item (org_id, institution_id, upper(tag));
CREATE INDEX asset_item_place_idx ON asset_item (org_id, institution_id, location_id);

CREATE TABLE asset_event (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  item_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('added', 'moved', 'custodian', 'condition', 'disposed')),
  from_value text NOT NULL DEFAULT '' CHECK (length(from_value) <= 200),
  to_value text NOT NULL DEFAULT '' CHECK (length(to_value) <= 200),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  by_person_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, item_id) REFERENCES asset_item (org_id, id),
  FOREIGN KEY (org_id, by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX asset_event_item_idx ON asset_event (org_id, item_id, at);

CREATE TABLE stock_item (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 20),
  reorder_level integer NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);
CREATE UNIQUE INDEX stock_item_name ON stock_item (org_id, institution_id, lower(btrim(name)));

CREATE TABLE stock_movement (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  item_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  quantity integer NOT NULL CHECK (quantity > 0),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  issued_to_person_id uuid,
  by_person_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, item_id) REFERENCES stock_item (org_id, id),
  FOREIGN KEY (org_id, issued_to_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, by_person_id) REFERENCES person (org_id, id),
  CHECK (direction = 'out' OR issued_to_person_id IS NULL)
);
CREATE INDEX stock_movement_item_idx ON stock_movement (org_id, item_id, at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asset_category', 'asset_location', 'asset_item', 'asset_event', 'stock_item',
    'stock_movement'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['asset_event', 'stock_movement'] LOOP
    EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_change()', t);
    EXECUTE format('CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_change()', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON asset_category, asset_location, asset_item, stock_item TO cv_app;
GRANT SELECT, INSERT ON asset_event, stock_movement TO cv_app;

INSERT INTO asset_category (org_id, name)
SELECT o.id, c.name FROM organisation o
CROSS JOIN (VALUES ('Furniture'), ('IT equipment'), ('Lab equipment'), ('Sports equipment'), ('Electrical'),
  ('Musical instruments'), ('Other')) AS c (name)
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('assets.item.read'), ('assets.item.manage'), ('assets.stock.manage')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal', 'office')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
