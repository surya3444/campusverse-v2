// Government Reports › APAAR reconciliation (rule book §15: "APAAR capture with consent; …
// reconciliation"; P0 item 15): APAAR IDs generated on the UDISE+ portal brought onto the
// learner record, matched by PEN and name, and stored only where APAAR consent counts.
import { withTenant } from '@campusverse/db';
import { setApaarIdsIn, studentFactsFor, studentIdsAt } from '@campusverse/people-records';
import { writeAudit } from '@campusverse/platform-audit';
import { consentCounts } from '@campusverse/platform-consent';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor } from '@campusverse/platform-permissions';
import { namesAgree, parseApaarCsv, type ApaarProblem } from '../domain/apaar.js';
import { ReturnsError, type ReturnsDeps } from './udise.js';

/** The consent purpose that covers creating and linking a student's APAAR ID (privacy catalogue). */
const PURPOSE = 'apaar_id';

export type ApaarOutcome = 'store' | 'no_consent' | 'unknown_pen' | 'name_mismatch' | ApaarProblem;
export type ApaarReconciliation = {
  rows: {
    line: number;
    pen: string;
    portalName: string;
    personId: string | null;
    name: string | null;
    outcome: ApaarOutcome;
  }[];
  counts: Record<ApaarOutcome, number>;
  stored: number;
};

/**
 * Matches a UDISE+ APAAR list to the school's students. With `apply`, stores the IDs of the rows
 * marked `store` (a student found by PEN, the names agreeing, APAAR consent counting); nothing else
 * is touched. Without it, a dry run.
 */
export async function reconcileApaar(
  deps: ReturnsDeps,
  actor: Actor,
  input: { institutionId: string; csv: string; apply: boolean },
): Promise<ApaarReconciliation> {
  if (!deps.keys) throw new Error('reconcileApaar: field keys missing');
  const keys = deps.keys;
  const parsed = parseApaarCsv(input.csv);
  if (!parsed.ok) throw new ReturnsError('missing_columns', { missing: parsed.missing });
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const place = await placeOf(tx, input.institutionId);
    if (!place) throw new ReturnsError('institution_not_found');
    const resource = { orgId: actor.orgId, place };
    await deps.permissions.assertCan(tx, actor, 'school.returns.read', resource);
    if (input.apply) await deps.permissions.assertCan(tx, actor, 'people.student.update', resource);
    const facts = await studentFactsFor(tx, await studentIdsAt(tx, input.institutionId));
    const byPen = new Map(facts.filter((f) => f.pen).map((f) => [f.pen as string, f]));
    const consented = await consentCounts(
      tx,
      facts.map((f) => f.personId),
      PURPOSE,
    );
    const rows: ApaarReconciliation['rows'] = parsed.lines.map((l) => {
      const f = l.problem ? undefined : byPen.get(l.pen);
      const outcome: ApaarOutcome = l.problem
        ? l.problem
        : !f
          ? 'unknown_pen'
          : !namesAgree(l.name, f.name)
            ? 'name_mismatch'
            : !consented.has(f.personId)
              ? 'no_consent'
              : 'store';
      return {
        line: l.line,
        pen: l.pen,
        portalName: l.name,
        personId: f?.personId ?? null,
        name: f?.name ?? null,
        outcome,
      };
    });
    const toStore = rows.flatMap((r, i) =>
      r.outcome === 'store' && r.personId
        ? [{ personId: r.personId, apaar: parsed.lines[i]?.apaar ?? '' }]
        : [],
    );
    const counts = Object.fromEntries(
      (
        [
          'store',
          'no_consent',
          'unknown_pen',
          'name_mismatch',
          'invalid_pen',
          'invalid_apaar',
        ] as const
      ).map((k) => [k, rows.filter((r) => r.outcome === k).length]),
    ) as Record<ApaarOutcome, number>;
    if (input.apply && toStore.length) {
      await setApaarIdsIn(tx, keys, actor.orgId, toStore);
      await writeAudit(tx, actor, {
        action: 'school.returns.apaar_reconcile',
        entityType: 'institution',
        entityId: input.institutionId,
        dataClass: 'restricted',
        detail: { stored: toStore.length, lines: rows.length, noConsent: counts.no_consent },
      });
    }
    return { rows, counts, stored: input.apply ? toStore.length : 0 };
  });
}
