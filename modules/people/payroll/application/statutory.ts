// Payroll › Statutory (rule book §13.7, §15): from an approved or paid run, EPFO's ECR file and
// the month's totals for the PF, ESI, professional tax and TDS challans. Staff without a UAN are
// listed, not guessed. The Labour Codes' wage rule is flagged per person.
import { withTenant } from '@campusverse/db';
import { statutoryIds } from '@campusverse/people-records';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor } from '@campusverse/platform-permissions';
import { payrollRulesAt } from '@campusverse/platform-rulepacks';
import { sql } from 'drizzle-orm';
import { monthBounds } from '../domain/pay.js';
import { ESI_HEADER, ecrMember, esiMember, wageRuleShortfall } from '../domain/statutory.js';
import { PayrollError, type PayrollDeps } from './payroll.js';

export type StatutoryReturns = {
  runId: string;
  month: string;
  state: string;
  /** ECR 2.0 text, one member per line, ready to upload to the EPFO portal. */
  ecr: string;
  ecrMembers: number;
  /** Staff with PF deducted but no UAN on record: add it on their staff record. */
  withoutUan: { personId: string; name: string }[];
  /** ESIC monthly contribution file (CSV in the portal's columns) and its members. */
  esi: string;
  esiMembers: number;
  /** Staff with ESI deducted but no IP number on record. */
  withoutIp: { personId: string; name: string }[];
  /** Basic + DA below half of gross (Labour Codes): the shortfall counts as wages. */
  wageRule: { personId: string; name: string; shortfallPaise: number }[];
  totals: {
    pfEmployeePaise: number;
    pfEmployerPaise: number;
    epsPaise: number;
    pfDifferencePaise: number;
    esiEmployeePaise: number;
    esiEmployerPaise: number;
    ptPaise: number;
    lwfEmployeePaise: number;
    lwfEmployerPaise: number;
    tdsPaise: number;
  };
};

export async function statutoryReturns(
  deps: PayrollDeps,
  actor: Actor,
  runId: string,
): Promise<StatutoryReturns> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [run] = await tx.execute<{ institutionId: string; month: string; state: string }>(sql`
      select institution_id::text as "institutionId", to_char(month, 'YYYY-MM') as month, state
      from payroll_run where org_id = app_current_org() and id = ${runId}`);
    if (!run) throw new PayrollError('run_not_found');
    const p = await placeOf(tx, run.institutionId);
    if (!p) throw new PayrollError('institution_not_found');
    const resource = { orgId: actor.orgId, place: p };
    const prepare = await deps.permissions.can(tx, actor, 'payroll.run.prepare', resource);
    if (!prepare.allowed)
      await deps.permissions.assertCan(tx, actor, 'payroll.run.approve', resource);
    if (run.state === 'draft') throw new PayrollError('not_approved');

    const rules = await payrollRulesAt(tx, run.institutionId, monthBounds(run.month).last);
    const slips = await tx.execute<{
      personId: string;
      name: string;
      basic: string;
      da: string;
      gross: string;
      pf: string;
      employerPf: string;
      esi: string;
      employerEsi: string;
      pt: string;
      tds: string;
      lwf: string;
      employerLwf: string;
      lopHalves: number;
      calendarDays: number;
    }>(sql`
      select person_id::text as "personId", snapshot ->> 'name' as name, basic_paise::text as basic,
        da_paise::text as da, gross_paise::text as gross, pf_paise::text as pf,
        employer_pf_paise::text as "employerPf", esi_paise::text as esi,
        employer_esi_paise::text as "employerEsi", pt_paise::text as pt, tds_paise::text as tds,
        lwf_paise::text as lwf, employer_lwf_paise::text as "employerLwf", calendar_days as "calendarDays",
        lop_halves as "lopHalves"
      from payroll_slip where org_id = app_current_org() and run_id = ${runId}
      order by snapshot ->> 'name'`);
    const ids = await statutoryIds(
      tx,
      slips.map((s) => s.personId),
    );
    const lines: string[] = [];
    const withoutUan: StatutoryReturns['withoutUan'] = [];
    const wageRule: StatutoryReturns['wageRule'] = [];
    const totals = {
      pfEmployeePaise: 0,
      pfEmployerPaise: 0,
      epsPaise: 0,
      pfDifferencePaise: 0,
      esiEmployeePaise: 0,
      esiEmployerPaise: 0,
      ptPaise: 0,
      lwfEmployeePaise: 0,
      lwfEmployerPaise: 0,
      tdsPaise: 0,
    };
    const esiLines: string[] = [];
    const withoutIp: StatutoryReturns['withoutIp'] = [];
    for (const s of slips) {
      const n = {
        basic: Number(s.basic),
        da: Number(s.da),
        gross: Number(s.gross),
        pf: Number(s.pf),
        employerPf: Number(s.employerPf),
      };
      totals.esiEmployeePaise += Number(s.esi);
      totals.esiEmployerPaise += Number(s.employerEsi);
      totals.ptPaise += Number(s.pt);
      totals.lwfEmployeePaise += Number(s.lwf);
      totals.lwfEmployerPaise += Number(s.employerLwf);
      totals.tdsPaise += Number(s.tds);
      if (Number(s.esi) > 0) {
        const ip = ids[s.personId]?.esiNumber;
        if (!ip) withoutIp.push({ personId: s.personId, name: s.name });
        else
          esiLines.push(
            esiMember({
              ipNumber: ip,
              name: s.name,
              calendarDays: s.calendarDays,
              lopHalves: s.lopHalves,
              grossPaise: n.gross,
            }),
          );
      }
      const shortfall = wageRuleShortfall({
        basicPaise: n.basic,
        daPaise: n.da,
        grossPaise: n.gross,
      });
      if (shortfall > 0)
        wageRule.push({ personId: s.personId, name: s.name, shortfallPaise: shortfall });
      if (n.pf === 0) continue;
      totals.pfEmployeePaise += n.pf;
      totals.pfEmployerPaise += n.employerPf;
      const uan = ids[s.personId]?.pfUan;
      if (!uan) {
        withoutUan.push({ personId: s.personId, name: s.name });
        continue;
      }
      const m = ecrMember(
        {
          uan,
          name: s.name,
          basicPaise: n.basic,
          daPaise: n.da,
          grossPaise: n.gross,
          pfPaise: n.pf,
          employerPfPaise: n.employerPf,
          lopHalves: s.lopHalves,
        },
        rules.pf,
      );
      totals.epsPaise += m.epsPaise;
      totals.pfDifferencePaise += m.differencePaise;
      lines.push(m.line);
    }
    return {
      runId,
      month: run.month,
      state: run.state,
      ecr: lines.join('\n'),
      ecrMembers: lines.length,
      withoutUan,
      esi: [ESI_HEADER.join(','), ...esiLines].join('\n'),
      esiMembers: esiLines.length,
      withoutIp,
      wageRule,
      totals,
    };
  });
}
