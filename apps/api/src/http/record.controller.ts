// The whole person on one screen (docs/specs/CONNECTED_SCHOOL.md): what every module knows about a
// student or a staff member, each part read through that module's contract under the viewer's own
// permission. A part the viewer may not see comes back as null, never as an error.
import { Id } from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import { appraisalsOf } from '@campusverse/people-appraisals';
import { salaryCard } from '@campusverse/people-payroll';
import { holidaysBetween } from '@campusverse/school-attendance';
import { PermissionDenied, type Actor } from '@campusverse/platform-permissions';
import { academicPlacement } from '@campusverse/academics-structure';
import type { AcademicPlacementPort } from '@campusverse/people-records';
import { schoolPlacement } from '@campusverse/school-enrolment';
import { assetsHeldBy } from '@campusverse/shared-assets';
import { ticketsAbout } from '@campusverse/shared-helpdesk';
import { childHostel } from '@campusverse/shared-hostel';
import { childLoans } from '@campusverse/shared-library';
import { leaveBalances, monthReport } from '@campusverse/shared-staff-attendance';
import { childBus, crewDuty } from '@campusverse/shared-transport';
import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { DB, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** A part the viewer may not see is left out. Anything else is a real failure. */
async function part<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof PermissionDenied) return null;
    throw e;
  }
}

const istMonth = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);

@Controller('people')
@UseGuards(ActorGuard)
export class RecordController {
  private readonly deps: { db: Db; permissions: Permissions; placements: AcademicPlacementPort[] };
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions, placements: [schoolPlacement, academicPlacement] };
  }

  /** Transport, hostel, library and requests for one student. */
  @Get('students/:id/services')
  async student(
    @Param('id') id: string,
    @Query('institutionId') institutionId: string,
    @Req() req: AuthedRequest,
  ): Promise<Record<string, unknown>> {
    const actor = actorOf(req);
    const personId = Id.parse(id);
    const inst = Id.parse(institutionId);
    const { db, permissions, placements } = this.deps;
    const [transport, hostel, library, requests] = await Promise.all([
      part(() => childBus(db, permissions, placements, actor, personId)),
      part(() => childHostel(this.deps, actor, personId)),
      part(() => childLoans(this.deps, actor, personId)),
      part(() => ticketsAbout(this.deps, actor, { institutionId: inst, personId })),
    ]);
    return {
      transport:
        transport?.map((b) => ({
          direction: b.direction,
          route: b.route,
          stop: b.stop,
          stopAt: b.stopAt,
        })) ?? null,
      hostel,
      library,
      requests: requests?.slice(0, 5) ?? null,
    };
  }

  /** This month's attendance, leave balances, appraisals, assets held, requests and bus duty. */
  @Get('staff/:id/services')
  async staff(
    @Param('id') id: string,
    @Query('institutionId') institutionId: string,
    @Req() req: AuthedRequest,
  ): Promise<Record<string, unknown>> {
    const actor = actorOf(req);
    const personId = Id.parse(id);
    const inst = Id.parse(institutionId);
    const { db, permissions } = this.deps;
    const month = istMonth();
    const [attendance, leave, appraisals, assets, requests, transport, salary] = await Promise.all([
      part(async () => {
        const r = await monthReport(db, permissions, actor, inst, month);
        return r.staff.find((s) => s.personId === personId) ?? null;
      }),
      part(async () => {
        const r = await leaveBalances(db, permissions, actor, inst);
        const mine = r.staff.find((s) => s.personId === personId);
        return mine ? { year: r.year, types: r.types, balances: mine.balances } : null;
      }),
      part(() => appraisalsOf(this.deps, actor, { institutionId: inst, personId })),
      part(() => assetsHeldBy(this.deps, actor, { institutionId: inst, personId })),
      part(() => ticketsAbout(this.deps, actor, { institutionId: inst, personId })),
      part(() => crewDuty(db, permissions, actor, { institutionId: inst, personId })),
      // Wrapped so "not allowed" (null) differs from "no salary set" ({ card: null }).
      part(async () => ({
        card: await salaryCard({ db, permissions, holidays: holidaysBetween }, actor, {
          institutionId: inst,
          personId,
        }),
      })),
    ]);
    return {
      month,
      attendance,
      leave,
      appraisals: appraisals?.slice(0, 3) ?? null,
      assets,
      requests: requests?.slice(0, 5) ?? null,
      transport,
      // undefined (left out) when the viewer can't see salaries; null when none is set.
      ...(salary ? { salary: salary.card } : {}),
    };
  }
}
