// Verse AI: staff papers waiting for a check, as counts by folder, for HR; and finding students
// and staff by name or number (names only, decision 0021), so other tools can act on the right person.
import { withTenant } from '@campusverse/db';
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { staffDocumentsAwaitingCheck } from './documents.js';
import { searchMembers } from './people.js';
import type { PeopleDeps } from './records.js';

export function peopleTools(deps: PeopleDeps): VerseTool[] {
  return [
    defineTool({
      name: 'people.find',
      description:
        'Find students or staff of this school by name, admission number or employee code. Returns ' +
        'each match with personId, name, kind (student or staff) and class or employee code. Use it ' +
        'before acting on a named person; if several match, ask which one.',
      permission: ['people.student.read', 'people.staff.read'],
      risk: 'read',
      dataClasses: ['names'],
      input: z.object({
        text: z.string().min(2).max(100),
        kind: z.enum(['student', 'staff', 'any']).default('any'),
      }),
      handler: async (ctx, { text, kind }) => {
        const found = await withTenant(deps.db, ctx.actor.orgId, async (tx) => {
          const [inst] = await tx.execute<{ campusId: string }>(sql`
            select campus_id::text as "campusId" from institution
            where org_id = app_current_org() and id = ${ctx.institutionId}`);
          const resource = {
            orgId: ctx.actor.orgId,
            ...(inst
              ? { place: { campusId: inst.campusId, institutionId: ctx.institutionId } }
              : {}),
          };
          const can = async (p: string) =>
            (await deps.permissions.can(tx, ctx.actor, p, resource)).allowed;
          const students = await can('people.student.read');
          const staff = await can('people.staff.read');
          const byNumber = (
            await Promise.all(
              deps.placements.map((p) =>
                p.findByReference(tx, { institutionId: ctx.institutionId, text }),
              ),
            )
          ).flat();
          const [d] = await tx.execute<{ today: string }>(sql`select app_today()::text as today`);
          const on = d?.today ?? ctx.today;
          const members = (
            await searchMembers(tx, {
              institutionId: ctx.institutionId,
              text,
              onDate: on,
              ids: byNumber,
            })
          ).filter(
            (m) => (m.kind === 'student' ? students : staff) && (kind === 'any' || m.kind === kind),
          );
          const placed = await Promise.all(
            deps.placements.map((p) =>
              p.getPlacements(tx, { personIds: members.map((m) => m.personId), onDate: on }),
            ),
          );
          return members.slice(0, 10).map((m) => {
            const pl = placed.map((x) => x.get(m.personId)).find((x) => x !== undefined);
            return {
              personId: m.personId,
              name: m.name,
              kind: m.kind,
              ...(m.kind === 'student'
                ? { class: pl?.displayLabel ?? null, admissionNo: pl?.reference ?? null }
                : { employeeCode: m.employeeCode }),
            };
          });
        });
        return { data: { matches: found } };
      },
    }),
    defineTool({
      name: 'people.documents.awaiting_check',
      description:
        'How many staff documents are uploaded but not yet verified or rejected, by folder. Counts only.',
      permission: ['people.staff.documents'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({}),
      handler: async (ctx) => {
        const byFolder = await withTenant(deps.db, ctx.actor.orgId, async (tx) => {
          await deps.permissions.assertCan(tx, ctx.actor, 'people.staff.documents', {
            orgId: ctx.actor.orgId,
          });
          return staffDocumentsAwaitingCheck(tx);
        });
        return {
          data: { total: Object.values(byFolder).reduce((a, b) => a + b, 0), byFolder },
          sources: [
            { label: 'Staff', href: '/staff', asOf: new Date().toISOString().slice(0, 10) },
          ],
        };
      },
    }),
  ];
}
