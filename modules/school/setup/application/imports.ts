import { withTenant, type Db, type Tx } from '@campusverse/db';
import { command, emit, type Consumer } from '@campusverse/platform-events';
import {
  addMembership,
  addPhone,
  createPerson,
  ensureStaffProfile,
  ensureStudentProfile,
  findByPhoneAndName,
  linkGuardian,
  removeImportedPeople,
} from '@campusverse/people-records';
import {
  assignRole,
  removeImportedRoles,
  type Actor,
  type createPermissions,
} from '@campusverse/platform-permissions';
import { enrol, enrolledKeys, removeImportedEnrolments } from '@campusverse/school-enrolment';
import { sql } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { readSheet } from 'read-excel-file/node';
import {
  validateStaff,
  validateStudents,
  type Problem,
  type StaffRow,
  type StudentRow,
  type Validated,
  type ValidatedRow,
} from '../domain/rows.js';
import { V1_MAX_CHARS, parseV1Export, v1StaffTable, v1StudentsTable } from '../domain/v1.js';
import { institutionResource, SetupError } from './common.js';

type Permissions = ReturnType<typeof createPermissions>;
export type ImportKind = 'students' | 'staff';

export const IMPORT_COMMIT_REQUESTED = 'school.import.commit_requested.v1';
export const IMPORT_COMMITTED = 'school.import.committed.v1';
export const IMPORT_UNDONE = 'school.import.undone.v1';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_UNZIPPED = 60 * 1024 * 1024;
const MAX_ROWS = 5000;

/**
 * Reads the first sheet of an .xlsx file. Checks it is a zip and how large it unpacks to before
 * parsing, so a small file can't expand into gigabytes.
 */
export async function readWorkbook(bytes: Uint8Array): Promise<unknown[][]> {
  if (bytes.length > MAX_BYTES) throw new SetupError('file_too_large');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new SetupError('not_xlsx');
  let unpacked = 0;
  try {
    unzipSync(bytes, {
      filter: (f) => {
        unpacked += f.originalSize;
        if (unpacked > MAX_UNZIPPED) throw new SetupError('file_too_large');
        return false; // list only; nothing is decompressed here
      },
    });
  } catch (e) {
    throw e instanceof SetupError ? e : new SetupError('not_xlsx');
  }
  let rows: unknown[][];
  try {
    rows = (await readSheet(Buffer.from(bytes))) as unknown[][];
  } catch {
    throw new SetupError('not_xlsx');
  }
  if (rows.length > MAX_ROWS + 1) throw new SetupError('too_many_rows', { max: MAX_ROWS });
  return rows;
}

/** The year imports go into: the one running today, else the next one to start. */
async function currentOrNextYear(tx: Tx, institutionId: string) {
  const [year] = await tx.execute<{ id: string; starts: string; endsExclusive: string }>(sql`
    select id::text, lower(valid_during)::text as starts, upper(valid_during)::text as "endsExclusive"
    from school_year
    where org_id = app_current_org() and institution_id = ${institutionId} and upper(valid_during) > app_today()
    order by lower(valid_during) limit 1`);
  return year ?? null;
}

async function setupYear(tx: Tx, institutionId: string) {
  const year = await currentOrNextYear(tx, institutionId);
  if (!year) throw new SetupError('no_year');
  return year;
}

/** Section ids by '5-A' for the year. */
async function sectionsOf(tx: Tx, yearId: string): Promise<Map<string, string>> {
  const rows = await tx.execute<{ key: string; id: string }>(sql`
    select c.code || '-' || s.name as key, s.id::text from school_section s
    join school_class c on c.org_id = s.org_id and c.id = s.class_id
    where s.org_id = app_current_org() and s.year_id = ${yearId}`);
  return new Map(rows.map((r) => [r.key, r.id]));
}

async function studentContext(tx: Tx, institutionId: string) {
  const year = await setupYear(tx, institutionId);
  const sections = await sectionsOf(tx, year.id);
  const enrolled = await enrolledKeys(tx, institutionId);
  return {
    year,
    sections,
    ctx: {
      sections: new Set(sections.keys()),
      existingAdmissions: enrolled.admissions,
      existingPeople: enrolled.people,
      yearStarts: year.starts,
    },
  };
}

/** Staff need no school year: colleges and universities import staff without classes. */
async function staffContext(tx: Tx, institutionId: string) {
  const year = await currentOrNextYear(tx, institutionId);
  const sections = year ? await sectionsOf(tx, year.id) : new Map<string, string>();
  const subjects = await tx.execute<{ id: string; code: string; name: string }>(sql`
    select id::text, code, name from school_subject
    where org_id = app_current_org() and institution_id = ${institutionId}`);
  const offerings = await tx.execute<{ k: string }>(sql`
    select c.code || ':' || sub.code as k from school_subject_offering o
    join school_class c on c.org_id = o.org_id and c.id = o.class_id
    join school_subject sub on sub.org_id = o.org_id and sub.id = o.subject_id
    where o.org_id = app_current_org() and o.year_id = ${year?.id ?? null}::uuid`);
  const taken = await tx.execute<{ id: string }>(sql`
    select section_id::text as id from school_teacher_allocation
    where org_id = app_current_org() and kind = 'class_teacher' and valid_during @> app_today()`);
  const codes = await tx.execute<{ c: string }>(sql`
    select employee_code as c from staff_profile where org_id = app_current_org()`);
  const takenIds = new Set(taken.map((t) => t.id));
  const subjectMap = new Map<string, string>();
  for (const s of subjects) {
    subjectMap.set(s.code.toLowerCase(), s.code);
    subjectMap.set(s.name.toLowerCase(), s.code);
  }
  return {
    year,
    sections,
    subjectIds: new Map(subjects.map((s) => [s.code, s.id])),
    ctx: {
      sections: new Set(sections.keys()),
      subjects: subjectMap,
      offerings: new Set(offerings.map((o) => o.k)),
      classTeachers: new Set([...sections].filter(([, id]) => takenIds.has(id)).map(([k]) => k)),
      existingCodes: new Set(codes.map((c) => c.c)),
    },
  };
}

export type ImportPreview = {
  batchId: string;
  kind: ImportKind;
  source: 'xlsx' | 'v1';
  /** V1 records left out before checking (students who left, staff who resigned). */
  skipped: number;
  counts: { total: number; valid: number; invalid: number; duplicate: number; warnings: number };
  ignoredColumns: string[];
  /** Rows that need a look: errors, duplicates or warnings. Clean rows are only counted. */
  flagged: {
    rowNumber: number;
    status: string;
    problems: Problem[];
    raw: Record<string, string>;
  }[];
  /** Where valid rows will land: students per section, or staff per role. */
  landing: Record<string, number>;
};

/** Wizard step 5: upload, validate and keep a preview. Nothing is created yet. */
export async function previewImport(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: {
    institutionId: string;
    kind: ImportKind;
    fileName: string;
    bytes: Uint8Array;
    /** 'v1': an export of the earlier Campusverse product, converted to the template's rows. */
    source?: 'xlsx' | 'v1';
  },
): Promise<ImportPreview> {
  const resource = await institutionResource(db, actor, input.institutionId);
  // Check before parsing, so people without the permission can't make the server unpack files.
  await withTenant(db, actor.orgId, (tx) =>
    permissions.assertCan(tx, actor, 'school.setup.manage', resource),
  );
  const source = input.source ?? 'xlsx';
  let skipped = 0;
  let table: unknown[][];
  if (source === 'v1') {
    if (input.bytes.length > V1_MAX_CHARS) throw new SetupError('file_too_large');
    const docs = parseV1Export(new TextDecoder().decode(input.bytes));
    if (!docs) throw new SetupError('not_a_v1_export');
    const converted = input.kind === 'students' ? v1StudentsTable(docs) : v1StaffTable(docs);
    table = converted.table;
    skipped = converted.skipped.length;
  } else table = await readWorkbook(input.bytes);

  return command(
    db,
    permissions,
    actor,
    { permission: 'school.setup.manage', resource },
    async (tx) => {
      const result: Validated<StudentRow> | Validated<StaffRow> =
        input.kind === 'students'
          ? validateStudents(table, (await studentContext(tx, input.institutionId)).ctx)
          : validateStaff(table, (await staffContext(tx, input.institutionId)).ctx);
      if (result.missingColumns.length > 0) {
        throw new SetupError('missing_columns', {
          missing: result.missingColumns,
          ignored: result.ignoredColumns,
        });
      }
      const rows = result.rows as ValidatedRow<StudentRow | StaffRow>[];
      if (rows.length === 0) throw new SetupError('empty_file');

      const count = (s: string) => rows.filter((r) => r.status === s).length;
      const counts = {
        total: rows.length,
        valid: count('valid'),
        invalid: count('invalid'),
        duplicate: count('duplicate'),
        warnings: rows.filter((r) => r.problems.some((p) => p.severity === 'warning')).length,
      };
      const [batch] = await tx.execute<{ id: string }>(sql`
      insert into import_batch (org_id, institution_id, kind, file_name, total_rows, valid_rows, invalid_rows,
        duplicate_rows, created_by_account_id, source)
      values (app_current_org(), ${input.institutionId}, ${input.kind}, ${input.fileName}, ${counts.total},
        ${counts.valid}, ${counts.invalid}, ${counts.duplicate}, ${actor.accountId}, ${source})
      returning id::text`);
      if (!batch) throw new Error('previewImport: batch insert returned no row');

      for (let i = 0; i < rows.length; i += 500) {
        await tx.execute(sql`
        insert into import_row (org_id, batch_id, row_number, status, data, problems)
        values ${sql.join(
          rows.slice(i, i + 500).map(
            (r) => sql`(app_current_org(), ${batch.id}, ${r.rowNumber}, ${r.status},
              ${JSON.stringify({ raw: r.raw, value: r.value })}::jsonb, ${JSON.stringify(r.problems)}::jsonb)`,
          ),
          sql`, `,
        )}`);
      }

      const landing: Record<string, number> = {};
      for (const r of rows) {
        if (r.status !== 'valid' || !r.value) continue;
        const key =
          'classCode' in r.value ? `${r.value.classCode}-${r.value.section}` : r.value.role;
        landing[key] = (landing[key] ?? 0) + 1;
      }

      return {
        result: {
          batchId: batch.id,
          kind: input.kind,
          source,
          skipped,
          counts,
          ignoredColumns: result.ignoredColumns,
          flagged: rows
            .filter((r) => r.status !== 'valid' || r.problems.length > 0)
            .map(({ rowNumber, status, problems, raw }) => ({ rowNumber, status, problems, raw })),
          landing,
        },
        audit: {
          action: 'school.setup.manage',
          entityType: 'import_batch',
          entityId: batch.id,
          dataClass: 'personal',
          detail: { step: 'import_preview', kind: input.kind, source, skipped, ...counts },
        },
      };
    },
  );
}

async function batchResource(db: Db, actor: Actor, batchId: string) {
  const [batch] = await withTenant(db, actor.orgId, (tx) =>
    tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from import_batch where org_id = app_current_org() and id = ${batchId}`),
  );
  if (!batch) throw new SetupError('import_not_found');
  return institutionResource(db, actor, batch.institutionId);
}

/** Commits the valid rows of a preview. Queued: a worker applies it, and status is polled. */
export async function commitImport(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  batchId: string,
): Promise<void> {
  const resource = await batchResource(db, actor, batchId);
  await command(
    db,
    permissions,
    actor,
    { permission: 'school.setup.manage', resource },
    async (tx) => {
      const [row] = await tx.execute(sql`
      update import_batch set status = 'committing'
      where org_id = app_current_org() and id = ${batchId} and status = 'previewed' returning id`);
      if (!row) throw new SetupError('import_not_previewed');
      return {
        result: undefined,
        audit: {
          action: 'school.setup.manage',
          entityType: 'import_batch',
          entityId: batchId,
          dataClass: 'personal',
          detail: { step: 'import_commit' },
        },
        events: [{ type: IMPORT_COMMIT_REQUESTED, payload: { batchId } }],
      };
    },
  );
}

/**
 * Finds or creates a person by phone and name (people module). Same phone and same name is the
 * same person; a different name is someone else on a shared family phone.
 */
async function personByPhone(
  tx: Tx,
  batchId: string,
  name: string,
  phone: string,
): Promise<string> {
  const existing = await findByPhoneAndName(tx, phone, name);
  if (existing) return existing;
  const id = await createPerson(tx, { legalName: name, source: 'import', importBatchId: batchId });
  await addPhone(tx, id, phone, { importBatchId: batchId });
  return id;
}

async function applyStudents(tx: Tx, batchId: string, institutionId: string) {
  const { year, sections } = await studentContext(tx, institutionId);
  const [org] = await tx.execute<{ id: string }>(sql`select app_current_org()::text as id`);
  const [first] = await tx.execute<{ d: string }>(
    sql`select greatest(${year.starts}::date, app_today())::text as d`,
  );
  if (!org || !first) throw new Error('import: no tenant');
  const rows = await tx.execute<{ data: { value: StudentRow } }>(sql`
    select data from import_row where org_id = app_current_org() and batch_id = ${batchId} and status = 'valid'
    order by row_number`);
  for (const { data } of rows) {
    const s = data.value;
    const sectionId = sections.get(`${s.classCode}-${s.section}`);
    if (!sectionId)
      throw new SetupError('section_gone', { section: `${s.classCode}-${s.section}` });
    const b = { importBatchId: batchId };
    const studentId = await createPerson(tx, {
      legalName: s.name,
      dateOfBirth: s.dateOfBirth,
      source: 'import',
      ...b,
    });
    await ensureStudentProfile(tx, studentId, b);
    await addMembership(tx, {
      personId: studentId,
      institutionId,
      kind: 'student',
      from: first.d,
      until: year.endsExclusive,
      ...b,
    });
    await enrol(tx, {
      personId: studentId,
      institutionId,
      sectionId,
      admissionNumber: s.admissionNumber,
      rollNumber: s.rollNumber,
      from: first.d,
      until: year.endsExclusive,
      ...b,
    });
    for (const [i, g] of s.guardians.entries()) {
      const guardianId = await personByPhone(tx, batchId, g.name, g.phone);
      await assignRole(tx, {
        personId: guardianId,
        roleKey: 'parent',
        scope: { type: 'organisation', id: org.id },
        ...b,
      });
      await linkGuardian(tx, {
        guardianId,
        studentId,
        relationship: g.relationship,
        primary: i === 0,
        ...b,
      });
    }
  }
}

async function applyStaff(tx: Tx, batchId: string, institutionId: string) {
  const { sections, subjectIds } = await staffContext(tx, institutionId);
  const [first] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  if (!first) throw new Error('import: no date');
  const rows = await tx.execute<{ data: { value: StaffRow } }>(sql`
    select data from import_row where org_id = app_current_org() and batch_id = ${batchId} and status = 'valid'
    order by row_number`);
  for (const { data } of rows) {
    const s = data.value;
    const b = { importBatchId: batchId };
    const personId = await personByPhone(tx, batchId, s.name, s.phone);
    await ensureStaffProfile(tx, personId, {
      employeeCode: s.employeeCode,
      workEmail: s.email,
      ...b,
    });
    await addMembership(tx, {
      personId,
      institutionId,
      kind: 'staff',
      from: first.d,
      until: null,
      ...b,
    });
    await assignRole(tx, {
      personId,
      roleKey: s.role,
      scope: { type: 'institution', id: institutionId },
      ...b,
    });
    if (s.classTeacherOf) {
      await tx.execute(sql`
        insert into school_teacher_allocation (org_id, section_id, teacher_person_id, kind, import_batch_id)
        values (app_current_org(), ${sections.get(s.classTeacherOf)}, ${personId}, 'class_teacher', ${batchId})`);
    }
    for (const t of s.teaches) {
      await tx.execute(sql`
        insert into school_teacher_allocation (org_id, section_id, subject_id, teacher_person_id, kind, import_batch_id)
        values (app_current_org(), ${sections.get(t.section)}, ${subjectIds.get(t.subjectCode)}, ${personId},
          'subject_teacher', ${batchId})`);
    }
  }
}

const pgCode = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.cause?.code ?? err.code;
};

/**
 * Applies a committed batch exactly once. If the school changed since the preview (a section
 * removed, a roll number taken), nothing is applied and the batch is marked failed with the reason.
 */
export const importCommitConsumer: Consumer = {
  name: 'school.import-commit',
  queue: 'imports',
  events: [IMPORT_COMMIT_REQUESTED],
  handle: async (tx, event) => {
    const batchId = String(event.payload.batchId);
    const [batch] = await tx.execute<{ kind: ImportKind; institutionId: string }>(sql`
      select kind, institution_id::text as "institutionId" from import_batch
      where org_id = app_current_org() and id = ${batchId} and status = 'committing' for update`);
    if (!batch) return;
    try {
      await tx.transaction(async (sp) => {
        if (batch.kind === 'students') await applyStudents(sp, batchId, batch.institutionId);
        else await applyStaff(sp, batchId, batch.institutionId);
      });
    } catch (e) {
      const reason =
        e instanceof SetupError
          ? e.code
          : pgCode(e) === '23P01'
            ? 'conflict_since_preview'
            : 'apply_failed';
      await tx.execute(sql`
        update import_batch set status = 'failed', failure = ${reason} where org_id = app_current_org() and id = ${batchId}`);
      return;
    }
    await tx.execute(sql`
      update import_batch set status = 'committed', committed_at = now()
      where org_id = app_current_org() and id = ${batchId}`);
    // The preview held a copy of the file only to apply it. Keep problems, drop the personal data.
    await tx.execute(sql`
      update import_row set data = '{"purged": true}'::jsonb
      where org_id = app_current_org() and batch_id = ${batchId}`);
    await emit(tx, { type: IMPORT_COMMITTED, payload: { batchId, kind: batch.kind } });
  },
};

/**
 * Removes everything a committed batch created. Refused once the data is in use (invites sent,
 * attendance taken): the database's foreign keys decide, so nothing in use can be lost.
 */
export async function undoImport(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  batchId: string,
): Promise<void> {
  const resource = await batchResource(db, actor, batchId);
  await command(
    db,
    permissions,
    actor,
    { permission: 'school.setup.manage', resource },
    async (tx) => {
      const [batch] = await tx.execute(sql`
      select 1 from import_batch where org_id = app_current_org() and id = ${batchId} and status = 'committed' for update`);
      if (!batch) throw new SetupError('import_not_committed');
      try {
        // Each module removes what the batch created in its own tables, most dependent first.
        await tx.transaction(async (sp) => {
          await sp.execute(sql`
            delete from school_teacher_allocation where org_id = app_current_org() and import_batch_id = ${batchId}`);
          await removeImportedEnrolments(sp, batchId);
          await removeImportedRoles(sp, batchId);
          await removeImportedPeople(sp, batchId);
        });
      } catch (e) {
        if (pgCode(e) === '23503') throw new SetupError('import_in_use');
        throw e;
      }
      await tx.execute(sql`
      update import_batch set status = 'undone', undone_at = now() where org_id = app_current_org() and id = ${batchId}`);
      return {
        result: undefined,
        audit: {
          action: 'school.setup.manage',
          entityType: 'import_batch',
          entityId: batchId,
          dataClass: 'personal',
          detail: { step: 'import_undo' },
        },
        events: [{ type: IMPORT_UNDONE, payload: { batchId } }],
      };
    },
  );
}

export async function getImport(db: Db, permissions: Permissions, actor: Actor, batchId: string) {
  const resource = await batchResource(db, actor, batchId);
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'school.setup.read', resource);
    const [batch] = await tx.execute<{
      id: string;
      kind: ImportKind;
      status: string;
      failure: string | null;
      total: number;
      valid: number;
      invalid: number;
      duplicate: number;
    }>(sql`
      select id::text, kind, status, failure, total_rows as total, valid_rows as valid, invalid_rows as invalid,
        duplicate_rows as duplicate
      from import_batch where org_id = app_current_org() and id = ${batchId}`);
    return batch ?? null;
  });
}
