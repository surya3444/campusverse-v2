import {
  Id,
  PayrollMonthInput,
  PayrollPaidInput,
  SalaryInput,
  SettlementDecisionInput,
  SettlementPaidInput,
  SettlementPrepareInput,
  TdsChallanInput,
  TdsQuarterQuery,
  TdsYearQuery,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import {
  approveRun,
  decideSettlement,
  deleteTdsChallan,
  form16Figures,
  recordTdsChallan,
  tdsQuarter,
  markRunPaid,
  markSettlementPaid,
  prepareSettlement,
  settlements,
  myPayslips,
  prepareRun,
  previewRun,
  runDetail,
  statutoryReturns,
  runs,
  salaries,
  salaryHistory,
  setSalary,
  type PayrollDeps,
} from '@campusverse/people-payroll';
import type { Actor } from '@campusverse/platform-permissions';
import { holidaysBetween } from '@campusverse/school-attendance';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { PeopleDeps } from '@campusverse/people-records';
import { DB, PEOPLE, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Payroll (docs/specs/PAYROLL.md). School holidays come from the school module's calendar. */
@Controller('payroll')
@UseGuards(ActorGuard)
export class PayrollController {
  private readonly deps: PayrollDeps;
  constructor(
    @Inject(DB) db: Db,
    @Inject(PERMISSIONS) permissions: Permissions,
    @Inject(PEOPLE) people: PeopleDeps,
  ) {
    this.deps = { db, permissions, holidays: holidaysBetween, keys: people.keys };
  }

  @Get('salaries')
  salaries(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return salaries(this.deps, actorOf(req), Id.parse(institutionId));
  }

  @Get('salaries/:personId')
  history(
    @Param('personId') personId: string,
    @Query('institutionId') institutionId: string,
    @Req() req: AuthedRequest,
  ) {
    return salaryHistory(this.deps, actorOf(req), {
      institutionId: Id.parse(institutionId),
      personId: Id.parse(personId),
    });
  }

  @Post('salaries')
  setSalary(@Body() body: unknown, @Req() req: AuthedRequest) {
    return setSalary(this.deps, actorOf(req), SalaryInput.parse(body));
  }

  @Get('runs')
  runs(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return runs(this.deps, actorOf(req), Id.parse(institutionId));
  }

  @Post('runs/preview')
  @HttpCode(200)
  preview(@Body() body: unknown, @Req() req: AuthedRequest) {
    return previewRun(this.deps, actorOf(req), PayrollMonthInput.parse(body));
  }

  @Post('runs')
  prepare(@Body() body: unknown, @Req() req: AuthedRequest) {
    return prepareRun(this.deps, actorOf(req), PayrollMonthInput.parse(body));
  }

  @Get('runs/:id')
  run(@Param('id') id: string, @Req() req: AuthedRequest) {
    return runDetail(this.deps, actorOf(req), Id.parse(id));
  }

  /** ECR and challan totals from an approved or paid run (rule book §13.7 Payroll › Statutory). */
  @Get('runs/:id/statutory')
  statutory(@Param('id') id: string, @Req() req: AuthedRequest) {
    return statutoryReturns(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('runs/:id/approve')
  @HttpCode(204)
  async approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    await approveRun(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('runs/:id/paid')
  @HttpCode(204)
  async paid(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await markRunPaid(this.deps, actorOf(req), {
      runId: Id.parse(id),
      ...PayrollPaidInput.parse(body),
    });
  }

  @Get('mine')
  mine(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return myPayslips(this.deps, actorOf(req), Id.parse(institutionId));
  }

  // Final settlement (rule book §13.7, Labour Codes) ---------------------------------------------

  @Get('settlements')
  settlements(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return settlements(this.deps, actorOf(req), Id.parse(institutionId));
  }

  @Post('settlements')
  async prepareSettlement(@Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await prepareSettlement(this.deps, actorOf(req), SettlementPrepareInput.parse(body)),
    };
  }

  @Post('settlements/:id/decision')
  async decideSettlement(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    return {
      outcome: await decideSettlement(this.deps, actorOf(req), {
        settlementId: Id.parse(id),
        ...SettlementDecisionInput.parse(body),
      }),
    };
  }

  @Post('settlements/:id/paid')
  @HttpCode(204)
  async settlementPaid(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await markSettlementPaid(this.deps, actorOf(req), {
      settlementId: Id.parse(id),
      ...SettlementPaidInput.parse(body),
    });
  }

  /** TDS on salaries (rule book §13.7 "TDS (24Q), Form 16"): a quarter against its challans. */
  @Get('tds')
  tds(@Query() query: unknown, @Req() req: AuthedRequest) {
    return tdsQuarter(this.deps, actorOf(req), TdsQuarterQuery.parse(query));
  }

  /** The quarter's 24Q worksheet with full PANs (audited). */
  @Get('tds/file')
  tdsFile(@Query() query: unknown, @Req() req: AuthedRequest) {
    return tdsQuarter(this.deps, actorOf(req), { ...TdsQuarterQuery.parse(query), file: true });
  }

  @Post('tds/challans')
  recordChallan(@Body() body: unknown, @Req() req: AuthedRequest) {
    return recordTdsChallan(this.deps, actorOf(req), TdsChallanInput.parse(body));
  }

  @Delete('tds/challans/:id')
  @HttpCode(204)
  async deleteChallan(@Param('id') id: string, @Req() req: AuthedRequest) {
    await deleteTdsChallan(this.deps, actorOf(req), Id.parse(id));
  }

  /** Each employee's Form 16 Part B figures for a financial year. */
  @Get('form16')
  form16(@Query() query: unknown, @Req() req: AuthedRequest) {
    return form16Figures(this.deps, actorOf(req), TdsYearQuery.parse(query));
  }

  /** The same with full PANs, as a CSV (audited). */
  @Get('form16/file')
  form16File(@Query() query: unknown, @Req() req: AuthedRequest) {
    return form16Figures(this.deps, actorOf(req), { ...TdsYearQuery.parse(query), file: true });
  }
}
