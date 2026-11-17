// Query types only. SQL migrations in ../migrations are the source of truth, including RLS.
import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  integer,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () =>
  uuid('id')
    .notNull()
    .default(sql`uuidv7()`);
const orgId = () => uuid('org_id').notNull();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const organisation = pgTable('organisation', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  name: text('name').notNull(),
  status: text('status', { enum: ['active', 'suspended', 'closed'] })
    .notNull()
    .default('active'),
  permissionVersion: integer('permission_version').notNull().default(1),
  createdAt: createdAt(),
});

export const legalEntity = pgTable(
  'legal_entity',
  {
    orgId: orgId(),
    id: id(),
    name: text('name').notNull(),
    gstin: text('gstin'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

export const campus = pgTable(
  'campus',
  { orgId: orgId(), id: id(), name: text('name').notNull(), createdAt: createdAt() },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

export const institution = pgTable(
  'institution',
  {
    orgId: orgId(),
    id: id(),
    campusId: uuid('campus_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    type: text('type', { enum: ['school', 'college', 'university'] }).notNull(),
    authorityCode: text('authority_code').notNull(),
    name: text('name').notNull(),
    status: text('status', {
      enum: ['draft', 'setup', 'pilot', 'live', 'read_only', 'suspended', 'closed'],
    })
      .notNull()
      .default('draft'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

// Postgres daterange as its text form, e.g. '[2026-06-01,2027-04-01)'.
const daterange = customType<{ data: string }>({ dataType: () => 'daterange' });
const validDuring = () =>
  daterange('valid_during')
    .notNull()
    .default(sql`daterange(app_today(), NULL)`);
const scopeType = () =>
  text('scope_type', { enum: ['organisation', 'campus', 'institution'] }).notNull();

export const person = pgTable(
  'person',
  {
    orgId: orgId(),
    id: id(),
    legalName: text('legal_name').notNull(),
    dateOfBirth: text('date_of_birth'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

export const guardianLink = pgTable(
  'guardian_link',
  {
    orgId: orgId(),
    id: id(),
    guardianPersonId: uuid('guardian_person_id').notNull(),
    studentPersonId: uuid('student_person_id').notNull(),
    relationship: text('relationship', {
      enum: ['mother', 'father', 'guardian', 'grandparent', 'sibling', 'other'],
    }).notNull(),
    isPrimaryContact: boolean('is_primary_contact').notNull().default(false),
    canLogin: boolean('can_login').notNull().default(true),
    isFeePayer: boolean('is_fee_payer').notNull().default(false),
    canPickup: boolean('can_pickup').notNull().default(false),
    academicMessages: boolean('academic_messages').notNull().default(true),
    feeMessages: boolean('fee_messages').notNull().default(false),
    locationAccess: boolean('location_access').notNull().default(false),
    restrictedAt: timestamp('restricted_at', { withTimezone: true }),
    restrictionReason: text('restriction_reason'),
    validDuring: validDuring(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

export const role = pgTable(
  'role',
  {
    orgId: orgId(),
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

export const GUARDIAN_FLAGS = [
  'is_fee_payer',
  'can_pickup',
  'academic_messages',
  'fee_messages',
  'location_access',
] as const;

export const roleGrant = pgTable(
  'role_grant',
  {
    orgId: orgId(),
    roleId: uuid('role_id').notNull(),
    permission: text('permission').notNull(),
    relation: text('relation', { enum: ['self', 'guardian'] }),
    guardianFlag: text('guardian_flag', { enum: GUARDIAN_FLAGS }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.roleId, t.permission] })],
);

export const roleAssignment = pgTable(
  'role_assignment',
  {
    orgId: orgId(),
    id: id(),
    personId: uuid('person_id').notNull(),
    roleId: uuid('role_id').notNull(),
    scopeType: scopeType(),
    scopeId: uuid('scope_id').notNull(),
    validDuring: validDuring(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

export const staffDuty = pgTable(
  'staff_duty',
  {
    orgId: orgId(),
    id: id(),
    personId: uuid('person_id').notNull(),
    duty: text('duty').notNull(),
    roleId: uuid('role_id').notNull(),
    scopeType: scopeType(),
    scopeId: uuid('scope_id').notNull(),
    validDuring: daterange('valid_during').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

// Global login identity. No RLS: these hold login facts only, never tenant data.
const identity = pgSchema('identity');
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const account = identity.table('account', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  status: text('status', { enum: ['active', 'locked', 'closed'] })
    .notNull()
    .default('active'),
  createdAt: createdAt(),
});

export const loginIdentifier = identity.table('login_identifier', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  accountId: uuid('account_id').notNull(),
  kind: text('kind', { enum: ['phone', 'email', 'google', 'microsoft'] }).notNull(),
  value: text('value').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const accountPersonLink = identity.table(
  'account_person_link',
  {
    accountId: uuid('account_id').notNull(),
    orgId: orgId(),
    personId: uuid('person_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.orgId, t.personId] })],
);

export const trustedDevice = identity.table('trusted_device', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  accountId: uuid('account_id').notNull(),
  label: text('label').notNull(),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const session = identity.table('session', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  familyId: uuid('family_id').notNull(),
  accountId: uuid('account_id').notNull(),
  deviceId: uuid('device_id').notNull(),
  accessHash: bytea('access_hash').notNull(),
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
  refreshHash: bytea('refresh_hash').notNull(),
  refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
  replacedBy: uuid('replaced_by'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: text('revoke_reason'),
  createdAt: createdAt(),
});
