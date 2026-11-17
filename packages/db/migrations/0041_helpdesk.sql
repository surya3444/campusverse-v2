-- Helpdesk, step 1 (docs/specs/HELPDESK.md). Owned by shared/helpdesk.

CREATE TABLE helpdesk_category (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  hours smallint NOT NULL CHECK (hours BETWEEN 1 AND 720),
  assignee_person_id uuid,
  audience text NOT NULL DEFAULT 'both' CHECK (audience IN ('parents', 'staff', 'both')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, assignee_person_id) REFERENCES person (org_id, id)
);
CREATE UNIQUE INDEX helpdesk_category_name ON helpdesk_category (org_id, lower(btrim(name)));

CREATE TABLE helpdesk_counter (
  org_id uuid NOT NULL REFERENCES organisation (id),
  institution_id uuid NOT NULL,
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number > 0),
  PRIMARY KEY (org_id, institution_id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);

CREATE TABLE helpdesk_ticket (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  category_id uuid NOT NULL,
  raised_by_person_id uuid NOT NULL,
  student_person_id uuid,
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 160),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'in_progress', 'waiting', 'resolved')),
  assignee_person_id uuid,
  due_at timestamptz NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, institution_id, number),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, category_id) REFERENCES helpdesk_category (org_id, id),
  FOREIGN KEY (org_id, raised_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, assignee_person_id) REFERENCES person (org_id, id),
  CHECK ((state = 'resolved') = (resolved_at IS NOT NULL)),
  CHECK (due_at > created_at)
);
CREATE INDEX helpdesk_ticket_queue_idx ON helpdesk_ticket (org_id, institution_id, state, due_at);
CREATE INDEX helpdesk_ticket_raiser_idx ON helpdesk_ticket (org_id, raised_by_person_id);
CREATE INDEX helpdesk_ticket_assignee_idx ON helpdesk_ticket (org_id, assignee_person_id) WHERE state <> 'resolved';

CREATE TABLE helpdesk_message (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  ticket_id uuid NOT NULL,
  author_person_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, ticket_id) REFERENCES helpdesk_ticket (org_id, id),
  FOREIGN KEY (org_id, author_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX helpdesk_message_ticket_idx ON helpdesk_message (org_id, ticket_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['helpdesk_category', 'helpdesk_counter', 'helpdesk_ticket', 'helpdesk_message'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON helpdesk_category, helpdesk_counter, helpdesk_ticket TO cv_app;
GRANT SELECT, INSERT ON helpdesk_message TO cv_app;

-- Default categories for existing organisations (new ones get them when set up).
INSERT INTO helpdesk_category (org_id, name, hours, audience)
SELECT o.id, c.name, c.hours, c.audience FROM organisation o
CROSS JOIN (VALUES ('Fees and payments', 24, 'both'), ('Transport', 8, 'both'), ('Academics and homework', 48, 'both'),
  ('Facilities and repairs', 72, 'staff'), ('IT and logins', 24, 'both'), ('Other', 48, 'both')) AS c (name, hours, audience)
ON CONFLICT DO NOTHING;

-- Helpdesk messages: the app first, WhatsApp if push doesn't arrive.
ALTER TABLE notification_message DROP CONSTRAINT notification_message_kind_check;
ALTER TABLE notification_message ADD CONSTRAINT notification_message_kind_check CHECK (kind IN (
  'urgent', 'absence', 'fee_receipt', 'fee_reminder', 'circular', 'homework', 'notice', 'account',
  'transport', 'gate', 'hostel', 'helpdesk'
)) NOT VALID;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue)
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'helpdesk.ticket.handle' FROM role r WHERE r.key IN ('owner', 'school_admin', 'principal', 'office')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'helpdesk.setup.manage' FROM role r WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'helpdesk.ticket.raise', CASE WHEN r.key = 'parent' THEN 'guardian' ELSE 'self' END
FROM role r
WHERE r.key IN ('owner', 'school_admin', 'principal', 'office', 'teacher', 'warden', 'security', 'bus_attendant',
  'driver', 'parent')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
