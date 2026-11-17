// The library across modules (docs/specs/LIBRARY.md): catalogue and accession numbers, issue
// within limits, return with fines, renew, lost, waive, overdue with the student's class, and the
// parent's view. Students' classes come from school enrolment, as the API wires it.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { grantPermission, seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  addCopies,
  addTitle,
  borrowerLoans,
  childLoans,
  findBorrowers,
  issueBook,
  libraryFigures,
  listTitles,
  markLost,
  overdueLoans,
  renewLoan,
  returnBook,
  suggestAccessions,
  updateLibrarySettings,
  waiveFine,
  withdrawCopy,
  type LibraryDeps,
} from '@campusverse/shared-library';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: LibraryDeps = {
  db,
  permissions: createPermissions(null),
  placements: [schoolPlacement],
};

let t: SeededTenant;
let librarian: Actor;
let teacher: Actor;
let parent: Actor;
let titleId: string;
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; name?: string }) =>
      e.name === 'PermissionDenied' ? 'denied' : (e.code ?? String(e)),
  );
/** Moves a loan's dates back, as if issued `days` ago. */
const age = (loanId: string, issuedDaysAgo: number, dueDaysAgo: number) =>
  withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`
      update library_loan set issued_on = app_today() - ${issuedDaysAgo}::int, due_on = app_today() - ${dueDaysAgo}::int
      where org_id = app_current_org() and id = ${loanId}`),
  );

beforeAll(async () => {
  t = await seedTenant(db, 'Library');
  librarian = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['library.book.read', 'library.book.manage']),
  };
  teacher = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['library.book.read']),
  };
  parent = { accountId: randomUUID(), orgId: t.orgId, personId: t.guardianId };
  await grantPermission(db, t.orgId, 'parent', 'library.book.read', 'guardian');
  titleId = (
    await addTitle(deps, librarian, {
      institutionId: t.institutionId,
      title: 'Synthetic Atlas of India',
      authors: 'B. Mapper',
      isbn: '9780000000002',
      publisher: '',
      year: 2024,
      subject: 'Geography',
      language: 'English',
      shelf: 'G-2',
    })
  ).id;
});
afterAll(() => close());

describe('the catalogue', () => {
  it('adds copies by accession number, suggests the next ones, refuses a number in use', async () => {
    // The seed has ACC-0001.
    expect(
      await suggestAccessions(deps, librarian, { institutionId: t.institutionId, count: 3 }),
    ).toEqual(['ACC-0002', 'ACC-0003', 'ACC-0004']);
    await addCopies(deps, librarian, {
      institutionId: t.institutionId,
      titleId,
      accessionNos: ['ACC-0002', 'ACC-0003', 'ACC-0004'],
      acquiredOn: null,
      pricePaise: 45_000,
    });
    expect(
      await code(
        addCopies(deps, librarian, {
          institutionId: t.institutionId,
          titleId,
          accessionNos: ['acc-0003'],
          acquiredOn: null,
          pricePaise: null,
        }),
      ),
    ).toBe('accession_taken');
    const [row] = await listTitles(deps, teacher, {
      institutionId: t.institutionId,
      search: 'atlas',
    });
    expect(row).toMatchObject({
      title: 'Synthetic Atlas of India',
      copies: 3,
      available: 3,
      onLoan: 0,
    });
    // By accession number too.
    expect(
      await listTitles(deps, teacher, { institutionId: t.institutionId, search: 'ACC-0004' }),
    ).toHaveLength(1);
    expect(
      await code(
        addTitle(deps, teacher, {
          institutionId: t.institutionId,
          title: 'Not allowed',
          authors: '',
          isbn: null,
          publisher: '',
          year: null,
          subject: '',
          language: '',
          shelf: '',
        }),
      ),
    ).toBe('denied');
  });
});

describe('circulation', () => {
  it('issues within the limit, finds borrowers by name, and returns with a fine', async () => {
    await updateLibrarySettings(deps, librarian, t.institutionId, {
      studentLoanDays: 14,
      staffLoanDays: 30,
      studentLimit: 2,
      staffLimit: 5,
      renewals: 1,
      finePerDayPaise: 200,
    });
    const found = await findBorrowers(deps, librarian, {
      institutionId: t.institutionId,
      text: 'Synthetic',
    });
    const student = found.find((b) => b.personId === t.studentId);
    expect(student).toMatchObject({ kind: 'student', label: 'Class 5-A', onLoan: 1 });

    // The seed already lent them one: one more reaches the limit of 2.
    const a = await issueBook(deps, librarian, {
      institutionId: t.institutionId,
      accessionNo: 'acc-0002',
      personId: t.studentId,
    });
    expect(a.title).toBe('Synthetic Atlas of India');
    expect(
      await code(
        issueBook(deps, librarian, {
          institutionId: t.institutionId,
          accessionNo: 'ACC-0003',
          personId: t.studentId,
        }),
      ),
    ).toBe('limit_reached');
    expect(
      await code(
        issueBook(deps, librarian, {
          institutionId: t.institutionId,
          accessionNo: 'ACC-0002',
          personId: t.teacherId,
        }),
      ),
    ).toBe('copy_not_available');
    expect(
      await code(
        issueBook(deps, librarian, {
          institutionId: t.institutionId,
          accessionNo: 'ACC-0003',
          personId: t.guardianId,
        }),
      ),
    ).toBe('not_a_member');

    // Returned 3 days late: ₹6 owed, set once.
    await age(a.loanId, 17, 3);
    const back = await returnBook(deps, librarian, {
      institutionId: t.institutionId,
      accessionNo: 'ACC-0002',
    });
    expect(back).toMatchObject({ daysLate: 3, finePaise: 600 });
    expect(
      await code(
        returnBook(deps, librarian, { institutionId: t.institutionId, accessionNo: 'ACC-0002' }),
      ),
    ).toBe('not_on_loan');
    const loans = await borrowerLoans(deps, librarian, {
      institutionId: t.institutionId,
      personId: t.studentId,
    });
    expect(loans.owedPaise).toBe(600);
    // Only the library may waive.
    expect(
      await code(
        waiveFine(deps, teacher, {
          institutionId: t.institutionId,
          loanId: a.loanId,
          reason: 'Please',
        }),
      ),
    ).toBe('denied');
    await waiveFine(deps, librarian, {
      institutionId: t.institutionId,
      loanId: a.loanId,
      reason: 'First time',
    });
    expect(
      (
        await borrowerLoans(deps, librarian, {
          institutionId: t.institutionId,
          personId: t.studentId,
        })
      ).owedPaise,
    ).toBe(0);
  });

  it('renews once, lists overdue loans with the class, and closes a loan as lost', async () => {
    const l = await issueBook(deps, librarian, {
      institutionId: t.institutionId,
      accessionNo: 'ACC-0003',
      personId: t.studentId,
    });
    await renewLoan(deps, librarian, { institutionId: t.institutionId, loanId: l.loanId });
    expect(
      await code(renewLoan(deps, librarian, { institutionId: t.institutionId, loanId: l.loanId })),
    ).toBe('no_renewals_left');
    await age(l.loanId, 20, 5);
    const overdue = await overdueLoans(deps, teacher, t.institutionId);
    expect(overdue.find((o) => o.loanId === l.loanId)).toMatchObject({
      label: 'Class 5-A',
      kind: 'student',
      daysLate: 5,
      fineIfToday: 1000,
    });
    const lost = await markLost(deps, librarian, {
      institutionId: t.institutionId,
      loanId: l.loanId,
    });
    expect(lost.finePaise).toBe(45_000);
    const fig = await libraryFigures(deps, teacher, t.institutionId);
    expect(fig).toMatchObject({ overdue: 0, owedPaise: 45_000 });
    // A copy on loan can't be withdrawn; an available one can, with a reason.
    expect(
      await code(
        withdrawCopy(deps, librarian, {
          institutionId: t.institutionId,
          copyId: randomUUID(),
          reason: 'Worn out',
        }),
      ),
    ).toBe('copy_not_found');
  });
});

describe("a parent's view", () => {
  it('shows their own child’s books and owed fines, and nobody else’s', async () => {
    const mine = await childLoans(deps, parent, t.studentId);
    expect(mine.open.map((l) => l.accessionNo)).toEqual(['ACC-0001']);
    expect(mine.owedPaise).toBe(45_000);
    await expect(childLoans(deps, parent, t.teacherId)).rejects.toBeInstanceOf(PermissionDenied);
    await expect(overdueLoans(deps, parent, t.institutionId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });
});
