// The library (docs/specs/LIBRARY.md): titles and copies with accession numbers, issue, return,
// renew and lost, limits and due dates, fines recorded (finance takes the money later), the
// overdue list and each borrower's loans. Borrowers come from people/records; a student's class
// from AcademicPlacementPort. Never reads academic tables.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import {
  displayNames,
  memberKind,
  searchMembers,
  type AcademicPlacementPort,
} from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions, Resource } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { addDays, dueDate, fineFor, nextAccessions } from '../domain/library.js';

type Permissions = ReturnType<typeof createPermissions>;
type Placements = Pick<AcademicPlacementPort, 'getPlacements' | 'findByReference'>[];
export type LibraryDeps = { db: Db; permissions: Permissions; placements: Placements };

export const LOAN_ISSUED = 'library.loan.issued.v1';
export const LOAN_RETURNED = 'library.loan.returned.v1';

export class LibraryError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'title_not_found'
      | 'copy_not_found'
      | 'loan_not_found'
      | 'not_a_member'
      | 'copy_not_available'
      | 'not_on_loan'
      | 'limit_reached'
      | 'no_renewals_left'
      | 'accession_taken'
      | 'no_fine'
      | 'not_lost',
    readonly details?: Record<string, unknown>,
  ) {
    super(`library: ${code}`);
    this.name = 'LibraryError';
  }
}

export type LibrarySettings = {
  studentLoanDays: number;
  staffLoanDays: number;
  studentLimit: number;
  staffLimit: number;
  renewals: number;
  finePerDayPaise: number;
};
const DEFAULTS: LibrarySettings = {
  studentLoanDays: 14,
  staffLoanDays: 30,
  studentLimit: 2,
  staffLimit: 5,
  renewals: 1,
  finePerDayPaise: 0,
};

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
async function place(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new LibraryError('institution_not_found');
  return p;
}
const where = (deps: LibraryDeps, actor: Actor, institutionId: string) =>
  withTenant(deps.db, actor.orgId, (tx) => place(tx, institutionId));
const res = (actor: Actor, p: Resource['place']): Resource => ({
  orgId: actor.orgId,
  ...(p ? { place: p } : {}),
});

async function settingsOf(tx: Tx, institutionId: string): Promise<LibrarySettings> {
  const [s] = await tx.execute<LibrarySettings>(sql`
    select student_loan_days as "studentLoanDays", staff_loan_days as "staffLoanDays",
      student_limit as "studentLimit", staff_limit as "staffLimit", renewals,
      fine_per_day_paise as "finePerDayPaise"
    from library_settings where org_id = app_current_org() and institution_id = ${institutionId}`);
  return s ?? DEFAULTS;
}

/** A read inside the tenant after `library.book.read` at the institution. */
async function reading<T>(
  deps: LibraryDeps,
  actor: Actor,
  institutionId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'library.book.read',
      res(actor, await place(tx, institutionId)),
    );
    return work(tx);
  });
}

export async function librarySettings(deps: LibraryDeps, actor: Actor, institutionId: string) {
  return reading(deps, actor, institutionId, (tx) => settingsOf(tx, institutionId));
}

export async function updateLibrarySettings(
  deps: LibraryDeps,
  actor: Actor,
  institutionId: string,
  s: LibrarySettings,
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'library.book.manage',
      resource: res(actor, await where(deps, actor, institutionId)),
    },
    async (tx) => {
      await tx.execute(sql`
        insert into library_settings (org_id, institution_id, student_loan_days, staff_loan_days, student_limit,
          staff_limit, renewals, fine_per_day_paise)
        values (app_current_org(), ${institutionId}, ${s.studentLoanDays}, ${s.staffLoanDays}, ${s.studentLimit},
          ${s.staffLimit}, ${s.renewals}, ${s.finePerDayPaise})
        on conflict (org_id, institution_id) do update set student_loan_days = excluded.student_loan_days,
          staff_loan_days = excluded.staff_loan_days, student_limit = excluded.student_limit,
          staff_limit = excluded.staff_limit, renewals = excluded.renewals,
          fine_per_day_paise = excluded.fine_per_day_paise, updated_at = now()`);
      return {
        result: undefined,
        audit: {
          action: 'library.settings.update',
          entityType: 'institution',
          entityId: institutionId,
          dataClass: 'operational',
          detail: { ...s },
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------------------------

export type TitleInput = {
  institutionId: string;
  title: string;
  authors: string;
  isbn: string | null;
  publisher: string;
  year: number | null;
  subject: string;
  language: string;
  shelf: string;
};
export type TitleRow = Omit<TitleInput, 'institutionId'> & {
  id: string;
  copies: number;
  available: number;
  onLoan: number;
};

export async function addTitle(
  deps: LibraryDeps,
  actor: Actor,
  input: TitleInput,
): Promise<{ id: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'library.book.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into library_title (org_id, institution_id, title, authors, isbn, publisher, year, subject, language, shelf)
        values (app_current_org(), ${input.institutionId}, ${input.title.trim()}, ${input.authors.trim()}, ${input.isbn},
          ${input.publisher.trim()}, ${input.year}, ${input.subject.trim()}, ${input.language.trim()}, ${input.shelf.trim()})
        returning id::text`);
      const id = row?.id ?? '';
      return {
        result: { id },
        audit: {
          action: 'library.title.add',
          entityType: 'library_title',
          entityId: id,
          dataClass: 'operational',
          detail: { title: input.title.trim(), isbn: input.isbn },
        },
      };
    },
  );
}

/** Titles matching the text (title, author, ISBN, subject), with how many copies are in and out. */
export async function listTitles(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; search?: string | undefined },
): Promise<TitleRow[]> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const q = `%${(input.search ?? '').trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return [
      ...(await tx.execute<TitleRow>(sql`
        select t.id::text, t.title, t.authors, t.isbn, t.publisher, t.year, t.subject, t.language, t.shelf,
          count(c.id) filter (where c.status <> 'withdrawn')::int as copies,
          count(c.id) filter (where c.status = 'available')::int as available,
          count(c.id) filter (where c.status = 'on_loan')::int as "onLoan"
        from library_title t left join library_copy c on c.org_id = t.org_id and c.title_id = t.id
        where t.org_id = app_current_org() and t.institution_id = ${input.institutionId}
          and (t.title ilike ${q} or t.authors ilike ${q} or coalesce(t.isbn, '') ilike ${q} or t.subject ilike ${q}
            or exists (select 1 from library_copy x where x.org_id = t.org_id and x.title_id = t.id
              and upper(x.accession_no) = upper(${(input.search ?? '').trim()})))
        group by t.org_id, t.id order by lower(t.title) limit 100`)),
    ];
  });
}

export type CopyRow = {
  id: string;
  accessionNo: string;
  status: 'available' | 'on_loan' | 'lost' | 'withdrawn';
  acquiredOn: string | null;
  pricePaise: number | null;
  note: string;
  /** Who has it and until when, while on loan. */
  loan: { loanId: string; borrower: string; dueOn: string } | null;
};

export async function titleCopies(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; titleId: string },
): Promise<CopyRow[]> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const rows = await tx.execute<
      Omit<CopyRow, 'loan'> & {
        loanId: string | null;
        borrowerId: string | null;
        dueOn: string | null;
      }
    >(sql`
      select c.id::text, c.accession_no as "accessionNo", c.status, c.acquired_on::text as "acquiredOn",
        c.price_paise as "pricePaise", c.note, l.id::text as "loanId", l.borrower_person_id::text as "borrowerId",
        l.due_on::text as "dueOn"
      from library_copy c
      left join library_loan l on l.org_id = c.org_id and l.copy_id = c.id and l.returned_on is null
      where c.org_id = app_current_org() and c.title_id = ${input.titleId} and c.institution_id = ${input.institutionId}
      order by c.accession_no`);
    const names = await displayNames(
      tx,
      rows.flatMap((r) => (r.borrowerId ? [r.borrowerId] : [])),
    );
    return rows.map(({ loanId, borrowerId, dueOn, ...c }) => ({
      ...c,
      loan:
        loanId && borrowerId && dueOn ? { loanId, borrower: names[borrowerId] ?? '', dueOn } : null,
    }));
  });
}

/** The next free accession numbers after the highest one in use. */
export async function suggestAccessions(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; count: number },
): Promise<string[]> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    // ponytail: reads every accession number; a numeric index if a library passes ~100k copies.
    const rows = await tx.execute<{ a: string }>(sql`
      select accession_no as a from library_copy where org_id = app_current_org() and institution_id = ${input.institutionId}`);
    return nextAccessions(
      rows.map((r) => r.a),
      Math.min(50, Math.max(1, input.count)),
    );
  });
}

/** Adds copies of a title by accession number; any number already in use refuses them all. */
export async function addCopies(
  deps: LibraryDeps,
  actor: Actor,
  input: {
    institutionId: string;
    titleId: string;
    accessionNos: string[];
    acquiredOn: string | null;
    pricePaise: number | null;
  },
): Promise<{ added: number }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'library.book.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const [t] = await tx.execute(sql`
        select 1 from library_title where org_id = app_current_org() and id = ${input.titleId}
          and institution_id = ${input.institutionId}`);
      if (!t) throw new LibraryError('title_not_found');
      const nos = [...new Set(input.accessionNos.map((a) => a.trim()).filter(Boolean))];
      const taken = await tx.execute<{ a: string }>(sql`
        select accession_no as a from library_copy where org_id = app_current_org()
          and institution_id = ${input.institutionId} and upper(accession_no) = any(${`{${nos.map((n) => n.toUpperCase()).join(',')}}`}::text[])`);
      if (taken.length > 0)
        throw new LibraryError('accession_taken', { taken: taken.map((r) => r.a) });
      for (const a of nos)
        await tx.execute(sql`
          insert into library_copy (org_id, institution_id, title_id, accession_no, acquired_on, price_paise)
          values (app_current_org(), ${input.institutionId}, ${input.titleId}, ${a}, ${input.acquiredOn}::date,
            ${input.pricePaise})`);
      return {
        result: { added: nos.length },
        audit: {
          action: 'library.copy.add',
          entityType: 'library_title',
          entityId: input.titleId,
          dataClass: 'operational',
          detail: { added: nos.length, accessionNos: nos.join(',').slice(0, 500) },
        },
      };
    },
  );
}

/** Withdraws an available copy (worn out, given away), with a reason; it stays in the register. */
export async function withdrawCopy(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; copyId: string; reason: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'library.book.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const [c] = await tx.execute<{ status: string; accessionNo: string }>(sql`
        select status, accession_no as "accessionNo" from library_copy
        where org_id = app_current_org() and id = ${input.copyId} and institution_id = ${input.institutionId} for update`);
      if (!c) throw new LibraryError('copy_not_found');
      if (c.status === 'on_loan') throw new LibraryError('copy_not_available');
      await tx.execute(sql`
        update library_copy set status = 'withdrawn', note = ${input.reason.trim().slice(0, 300)}
        where org_id = app_current_org() and id = ${input.copyId}`);
      return {
        result: undefined,
        audit: {
          action: 'library.copy.withdraw',
          entityType: 'library_copy',
          entityId: input.copyId,
          dataClass: 'operational',
          reason: input.reason.trim(),
          detail: { accessionNo: c.accessionNo, was: c.status },
        },
      };
    },
  );
}

/** A lost copy that turned up goes back on the shelf. */
export async function foundCopy(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; copyId: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'library.book.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const [c] = await tx.execute<{ status: string }>(sql`
        select status from library_copy where org_id = app_current_org() and id = ${input.copyId}
          and institution_id = ${input.institutionId} for update`);
      if (!c) throw new LibraryError('copy_not_found');
      if (c.status !== 'lost') throw new LibraryError('not_lost');
      await tx.execute(sql`
        update library_copy set status = 'available' where org_id = app_current_org() and id = ${input.copyId}`);
      return {
        result: undefined,
        audit: {
          action: 'library.copy.found',
          entityType: 'library_copy',
          entityId: input.copyId,
          dataClass: 'operational',
          detail: {},
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Borrowers and circulation
// ---------------------------------------------------------------------------------------------

export type Borrower = {
  personId: string;
  name: string;
  kind: 'student' | 'staff';
  /** "Class 5-A" or the employee code. */
  label: string | null;
  onLoan: number;
  overdue: number;
};

async function labels(tx: Tx, deps: LibraryDeps, ids: string[], on: string) {
  const found = await Promise.all(
    deps.placements.map((p) => p.getPlacements(tx, { personIds: ids, onDate: on })),
  );
  return (id: string) => found.map((m) => m.get(id)).find((x) => x !== undefined);
}

/** Students and staff by name, admission number or employee code, with what they have out. */
export async function findBorrowers(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; text: string },
): Promise<Borrower[]> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    if (input.text.trim().length < 2) return [];
    const on = await today(tx);
    const byNumber = (
      await Promise.all(
        deps.placements.map((p) =>
          p.findByReference(tx, { institutionId: input.institutionId, text: input.text }),
        ),
      )
    ).flat();
    const members = await searchMembers(tx, {
      institutionId: input.institutionId,
      text: input.text,
      onDate: on,
      ids: byNumber,
    });
    const loans = await tx.execute<{ id: string; open: number; late: number }>(sql`
      select borrower_person_id::text as id, count(*)::int as open, count(*) filter (where due_on < ${on}::date)::int as late
      from library_loan where org_id = app_current_org() and returned_on is null
        and borrower_person_id = any(${`{${members.map((m) => m.personId).join(',')}}`}::uuid[])
      group by borrower_person_id`);
    const placed = await labels(
      tx,
      deps,
      members.map((m) => m.personId),
      on,
    );
    return members.map((m) => {
      const l = loans.find((x) => x.id === m.personId);
      return {
        personId: m.personId,
        name: m.name,
        kind: m.kind,
        label: m.kind === 'staff' ? m.employeeCode : (placed(m.personId)?.displayLabel ?? null),
        onLoan: l?.open ?? 0,
        overdue: l?.late ?? 0,
      };
    });
  });
}

async function copyByAccession(tx: Tx, institutionId: string, accessionNo: string) {
  const [c] = await tx.execute<{
    id: string;
    status: string;
    title: string;
    pricePaise: number | null;
  }>(sql`
    select c.id::text, c.status, t.title, c.price_paise as "pricePaise"
    from library_copy c join library_title t on t.org_id = c.org_id and t.id = c.title_id
    where c.org_id = app_current_org() and c.institution_id = ${institutionId}
      and upper(c.accession_no) = upper(${accessionNo.trim()}) for update of c`);
  if (!c) throw new LibraryError('copy_not_found');
  return c;
}

/**
 * Issues a copy to a student or staff member of the institution, within their limit, due after
 * their loan days. A borrower with an overdue book still borrows; the result says so.
 */
export async function issueBook(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; accessionNo: string; personId: string },
): Promise<{ loanId: string; title: string; borrower: string; dueOn: string; overdue: number }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'library.book.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const on = await today(tx);
      const kind = await memberKind(tx, {
        institutionId: input.institutionId,
        personId: input.personId,
        onDate: on,
      });
      if (!kind) throw new LibraryError('not_a_member');
      const c = await copyByAccession(tx, input.institutionId, input.accessionNo);
      if (c.status !== 'available')
        throw new LibraryError('copy_not_available', { status: c.status });
      const s = await settingsOf(tx, input.institutionId);
      const [open] = await tx.execute<{ n: number; late: number }>(sql`
        select count(*)::int as n, count(*) filter (where due_on < ${on}::date)::int as late
        from library_loan where org_id = app_current_org() and borrower_person_id = ${input.personId} and returned_on is null`);
      const limit = kind === 'staff' ? s.staffLimit : s.studentLimit;
      if ((open?.n ?? 0) >= limit) throw new LibraryError('limit_reached', { limit });
      const due = dueDate(on, kind === 'staff' ? s.staffLoanDays : s.studentLoanDays);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into library_loan (org_id, institution_id, copy_id, borrower_person_id, borrower_kind, issued_on, due_on,
          issued_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${c.id}, ${input.personId}, ${kind}, ${on}::date, ${due}::date,
          ${actor.personId})
        returning id::text`);
      await tx.execute(
        sql`update library_copy set status = 'on_loan' where org_id = app_current_org() and id = ${c.id}`,
      );
      const loanId = row?.id ?? '';
      const borrower = (await displayNames(tx, [input.personId]))[input.personId] ?? '';
      return {
        result: { loanId, title: c.title, borrower, dueOn: due, overdue: open?.late ?? 0 },
        audit: {
          action: 'library.loan.issue',
          entityType: 'person',
          entityId: input.personId,
          dataClass: 'personal',
          detail: { loanId, accessionNo: input.accessionNo.trim(), dueOn: due },
        },
        events: [{ type: LOAN_ISSUED, payload: { loanId, institutionId: input.institutionId } }],
      };
    },
  );
}

/** Takes a copy back. A late return with fines on records the fine, set now and never recalculated. */
export async function returnBook(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; accessionNo: string },
): Promise<{
  loanId: string;
  title: string;
  borrower: string;
  daysLate: number;
  finePaise: number;
}> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'library.book.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const c = await copyByAccession(tx, input.institutionId, input.accessionNo);
      const [l] = await tx.execute<{ id: string; dueOn: string; borrowerId: string }>(sql`
        select id::text, due_on::text as "dueOn", borrower_person_id::text as "borrowerId" from library_loan
        where org_id = app_current_org() and copy_id = ${c.id} and returned_on is null for update`);
      if (!l) throw new LibraryError('not_on_loan');
      const on = await today(tx);
      const { daysLate, finePaise } = fineFor(
        l.dueOn,
        on,
        (await settingsOf(tx, input.institutionId)).finePerDayPaise,
      );
      await tx.execute(sql`
        update library_loan set returned_on = ${on}::date, outcome = 'returned', returned_by_person_id = ${actor.personId},
          fine_paise = ${finePaise}, fine_state = ${finePaise > 0 ? 'owed' : 'none'}
        where org_id = app_current_org() and id = ${l.id}`);
      await tx.execute(
        sql`update library_copy set status = 'available' where org_id = app_current_org() and id = ${c.id}`,
      );
      const borrower = (await displayNames(tx, [l.borrowerId]))[l.borrowerId] ?? '';
      return {
        result: { loanId: l.id, title: c.title, borrower, daysLate, finePaise },
        audit: {
          action: 'library.loan.return',
          entityType: 'person',
          entityId: l.borrowerId,
          dataClass: 'personal',
          detail: { loanId: l.id, accessionNo: input.accessionNo.trim(), daysLate, finePaise },
        },
        events: [
          { type: LOAN_RETURNED, payload: { loanId: l.id, institutionId: input.institutionId } },
        ],
      };
    },
  );
}

async function openLoan(tx: Tx, loanId: string, institutionId: string) {
  const [l] = await tx.execute<{
    id: string;
    copyId: string;
    borrowerId: string;
    kind: 'student' | 'staff';
    renewals: number;
    pricePaise: number | null;
  }>(sql`
    select l.id::text, l.copy_id::text as "copyId", l.borrower_person_id::text as "borrowerId", l.borrower_kind as kind,
      l.renewals, c.price_paise as "pricePaise"
    from library_loan l join library_copy c on c.org_id = l.org_id and c.id = l.copy_id
    where l.org_id = app_current_org() and l.id = ${loanId} and l.institution_id = ${institutionId}
      and l.returned_on is null for update of l`);
  if (!l) throw new LibraryError('loan_not_found');
  return l;
}

/** Renews a loan from today for another loan period, while renewals are left. */
export async function renewLoan(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; loanId: string },
): Promise<{ dueOn: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'library.book.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const l = await openLoan(tx, input.loanId, input.institutionId);
      const s = await settingsOf(tx, input.institutionId);
      if (l.renewals >= s.renewals) throw new LibraryError('no_renewals_left');
      const due = dueDate(
        await today(tx),
        l.kind === 'staff' ? s.staffLoanDays : s.studentLoanDays,
      );
      await tx.execute(sql`
        update library_loan set due_on = ${due}::date, renewals = renewals + 1
        where org_id = app_current_org() and id = ${l.id}`);
      return {
        result: { dueOn: due },
        audit: {
          action: 'library.loan.renew',
          entityType: 'person',
          entityId: l.borrowerId,
          dataClass: 'personal',
          detail: { loanId: l.id, dueOn: due },
        },
      };
    },
  );
}

/** Closes a loan as lost: the copy is lost; the fine is its price when one is recorded. */
export async function markLost(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; loanId: string },
): Promise<{ finePaise: number }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'library.book.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const l = await openLoan(tx, input.loanId, input.institutionId);
      const fine = l.pricePaise ?? 0;
      await tx.execute(sql`
        update library_loan set returned_on = app_today(), outcome = 'lost', returned_by_person_id = ${actor.personId},
          fine_paise = ${fine}, fine_state = ${fine > 0 ? 'owed' : 'none'}
        where org_id = app_current_org() and id = ${l.id}`);
      await tx.execute(
        sql`update library_copy set status = 'lost' where org_id = app_current_org() and id = ${l.copyId}`,
      );
      return {
        result: { finePaise: fine },
        audit: {
          action: 'library.loan.lost',
          entityType: 'person',
          entityId: l.borrowerId,
          dataClass: 'personal',
          detail: { loanId: l.id, finePaise: fine },
        },
        events: [
          { type: LOAN_RETURNED, payload: { loanId: l.id, institutionId: input.institutionId } },
        ],
      };
    },
  );
}

/** Waives an owed fine, with a reason. */
export async function waiveFine(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; loanId: string; reason: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'library.book.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const [l] = await tx.execute<{ borrowerId: string; finePaise: number; state: string }>(sql`
        select borrower_person_id::text as "borrowerId", fine_paise as "finePaise", fine_state as state from library_loan
        where org_id = app_current_org() and id = ${input.loanId} and institution_id = ${input.institutionId} for update`);
      if (!l) throw new LibraryError('loan_not_found');
      if (l.state !== 'owed') throw new LibraryError('no_fine');
      const reason = input.reason.trim();
      await tx.execute(sql`
        update library_loan set fine_state = 'waived', waive_reason = ${reason}
        where org_id = app_current_org() and id = ${input.loanId}`);
      return {
        result: undefined,
        audit: {
          action: 'library.fine.waive',
          entityType: 'person',
          entityId: l.borrowerId,
          dataClass: 'personal',
          reason,
          detail: { loanId: input.loanId, finePaise: l.finePaise },
        },
      };
    },
  );
}

export type LoanRow = {
  loanId: string;
  accessionNo: string;
  title: string;
  issuedOn: string;
  dueOn: string;
  renewals: number;
  returnedOn: string | null;
  outcome: 'returned' | 'lost' | null;
  daysLate: number;
  finePaise: number;
  fineState: 'none' | 'owed' | 'waived';
};
const loanSelect = (on: string) => sql`
  select l.id::text as "loanId", c.accession_no as "accessionNo", t.title, l.issued_on::text as "issuedOn",
    l.due_on::text as "dueOn", l.renewals, l.returned_on::text as "returnedOn", l.outcome,
    greatest(0, coalesce(l.returned_on, ${on}::date) - l.due_on)::int as "daysLate",
    l.fine_paise as "finePaise", l.fine_state as "fineState", l.borrower_person_id::text as "borrowerId",
    l.borrower_kind as "borrowerKind"
  from library_loan l
  join library_copy c on c.org_id = l.org_id and c.id = l.copy_id
  join library_title t on t.org_id = c.org_id and t.id = c.title_id`;

export type OverdueRow = LoanRow & {
  borrowerId: string;
  borrower: string;
  kind: 'student' | 'staff';
  label: string | null;
  /** The fine if returned today (fines on). */
  fineIfToday: number;
};

/** Every overdue loan at the institution, most overdue first. */
export async function overdueLoans(
  deps: LibraryDeps,
  actor: Actor,
  institutionId: string,
): Promise<OverdueRow[]> {
  return reading(deps, actor, institutionId, async (tx) => {
    const on = await today(tx);
    const rows = await tx.execute<
      LoanRow & { borrowerId: string; borrowerKind: 'student' | 'staff' }
    >(sql`
      ${loanSelect(on)}
      where l.org_id = app_current_org() and l.institution_id = ${institutionId} and l.returned_on is null
        and l.due_on < ${on}::date
      order by l.due_on, t.title`);
    const ids = [...new Set(rows.map((r) => r.borrowerId))];
    const names = await displayNames(tx, ids);
    const placed = await labels(tx, deps, ids, on);
    const perDay = (await settingsOf(tx, institutionId)).finePerDayPaise;
    return rows.map(({ borrowerKind, ...r }) => ({
      ...r,
      borrower: names[r.borrowerId] ?? '',
      kind: borrowerKind,
      label: borrowerKind === 'student' ? (placed(r.borrowerId)?.displayLabel ?? null) : null,
      fineIfToday: r.daysLate * perDay,
    }));
  });
}

export type BorrowerLoans = {
  open: LoanRow[];
  past: LoanRow[];
  owedPaise: number;
};

async function loansOf(
  tx: Tx,
  personId: string,
  institutionId: string | null,
): Promise<BorrowerLoans> {
  const on = await today(tx);
  const rows = await tx.execute<LoanRow>(sql`
    ${loanSelect(on)}
    where l.org_id = app_current_org() and l.borrower_person_id = ${personId}
      and (${institutionId}::uuid is null or l.institution_id = ${institutionId}::uuid)
      and (l.returned_on is null or l.returned_on > ${addDays(on, -365)}::date or l.fine_state = 'owed')
    order by l.returned_on nulls first, l.due_on desc limit 60`);
  return {
    open: rows.filter((r) => !r.returnedOn),
    past: rows.filter((r) => r.returnedOn).slice(0, 20),
    owedPaise: rows.filter((r) => r.fineState === 'owed').reduce((n, r) => n + r.finePaise, 0),
  };
}

/** One borrower's loans now and in the last year, and fines owed (staff). */
export async function borrowerLoans(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; personId: string },
): Promise<BorrowerLoans> {
  return reading(deps, actor, input.institutionId, (tx) =>
    loansOf(tx, input.personId, input.institutionId),
  );
}

/** A child's books for their guardians (relation guardian). */
export async function childLoans(
  deps: LibraryDeps,
  actor: Actor,
  studentId: string,
): Promise<BorrowerLoans> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const on = await today(tx);
    const placed = await labels(tx, deps, [studentId], on);
    const inst = placed(studentId)?.institutionId;
    const p = inst ? await placeOf(tx, inst) : null;
    await deps.permissions.assertCan(tx, actor, 'library.book.read', {
      orgId: actor.orgId,
      ...(p ? { place: p } : {}),
      subjectPersonId: studentId,
    });
    return loansOf(tx, studentId, null);
  });
}

/** The desk's key figures. */
export async function libraryFigures(deps: LibraryDeps, actor: Actor, institutionId: string) {
  return reading(deps, actor, institutionId, async (tx) => {
    const on = await today(tx);
    const [r] = await tx.execute<{
      titles: number;
      copies: number;
      onLoan: number;
      overdue: number;
      owedPaise: number;
    }>(sql`
      select (select count(*)::int from library_title where org_id = app_current_org() and institution_id = ${institutionId}) as titles,
        (select count(*)::int from library_copy where org_id = app_current_org() and institution_id = ${institutionId}
          and status <> 'withdrawn') as copies,
        (select count(*)::int from library_loan where org_id = app_current_org() and institution_id = ${institutionId}
          and returned_on is null) as "onLoan",
        (select count(*)::int from library_loan where org_id = app_current_org() and institution_id = ${institutionId}
          and returned_on is null and due_on < ${on}::date) as overdue,
        (select coalesce(sum(fine_paise), 0)::int from library_loan where org_id = app_current_org()
          and institution_id = ${institutionId} and fine_state = 'owed') as "owedPaise"`);
    return r ?? { titles: 0, copies: 0, onLoan: 0, overdue: 0, owedPaise: 0 };
  });
}

// ---------------------------------------------------------------------------------------------
// Previews for Verse AI (decision 0021): what a return or an issue would do, changing nothing
// ---------------------------------------------------------------------------------------------

/** The open loan on a copy, and what returning it today would charge. */
export async function returnPreview(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; accessionNo: string },
): Promise<
  | {
      ok: true;
      title: string;
      borrower: string;
      dueOn: string;
      daysLate: number;
      finePaise: number;
    }
  | { ok: false; problem: 'copy_not_found' | 'not_on_loan' }
> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const c = await copyByAccession(tx, input.institutionId, input.accessionNo).catch(() => null);
    if (!c) return { ok: false as const, problem: 'copy_not_found' as const };
    const [l] = await tx.execute<{ dueOn: string; borrowerId: string }>(sql`
      select due_on::text as "dueOn", borrower_person_id::text as "borrowerId" from library_loan
      where org_id = app_current_org() and copy_id = ${c.id} and returned_on is null`);
    if (!l) return { ok: false as const, problem: 'not_on_loan' as const };
    const fine = fineFor(
      l.dueOn,
      await today(tx),
      (await settingsOf(tx, input.institutionId)).finePerDayPaise,
    );
    return {
      ok: true as const,
      title: c.title,
      borrower: (await displayNames(tx, [l.borrowerId]))[l.borrowerId] ?? '',
      dueOn: l.dueOn,
      ...fine,
    };
  });
}

/** Whether a copy can go to a person now, and when it would be due. */
export async function issuePreview(
  deps: LibraryDeps,
  actor: Actor,
  input: { institutionId: string; accessionNo: string; personId: string },
): Promise<
  | { ok: true; title: string; borrower: string; dueOn: string; overdue: number }
  | {
      ok: false;
      problem: 'copy_not_found' | 'copy_not_available' | 'not_a_member' | 'limit_reached';
    }
> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const on = await today(tx);
    const c = await copyByAccession(tx, input.institutionId, input.accessionNo).catch(() => null);
    if (!c) return { ok: false as const, problem: 'copy_not_found' as const };
    if (c.status !== 'available')
      return { ok: false as const, problem: 'copy_not_available' as const };
    const kind = await memberKind(tx, {
      institutionId: input.institutionId,
      personId: input.personId,
      onDate: on,
    });
    if (!kind) return { ok: false as const, problem: 'not_a_member' as const };
    const s = await settingsOf(tx, input.institutionId);
    const [open] = await tx.execute<{ n: number; late: number }>(sql`
      select count(*)::int as n, count(*) filter (where due_on < ${on}::date)::int as late
      from library_loan where org_id = app_current_org() and borrower_person_id = ${input.personId}
        and returned_on is null`);
    if ((open?.n ?? 0) >= (kind === 'staff' ? s.staffLimit : s.studentLimit))
      return { ok: false as const, problem: 'limit_reached' as const };
    return {
      ok: true as const,
      title: c.title,
      borrower: (await displayNames(tx, [input.personId]))[input.personId] ?? '',
      dueOn: dueDate(on, kind === 'staff' ? s.staffLoanDays : s.studentLoanDays),
      overdue: open?.late ?? 0,
    };
  });
}
