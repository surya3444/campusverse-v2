import {
  Day,
  GateBarInput,
  GateCheckInInput,
  GateExpectInput,
  GateMobile,
  GatePassInput,
  GatePlaceInput,
  GateReasonInput,
  Id,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import { academicPlacement } from '@campusverse/academics-structure';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  barVisitor,
  barredVisitors,
  cancelExpected,
  cancelPass,
  checkIn,
  checkOut,
  expectVisitor,
  findPeople,
  gateToday,
  issuePass,
  liftBar,
  myExpected,
  passLeft,
  pickupOptions,
  visitHistory,
  visitorByPhone,
  type GateDeps,
} from '@campusverse/shared-gate';
import {
  Body,
  Controller,
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
import { z } from 'zod';
import { DB, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};
const Kind = z.enum(['staff', 'student']);

/** Visitors and gate (docs/specs/VISITORS_GATE.md): the gate's day, visits, barred, passes. */
@Controller('gate')
@UseGuards(ActorGuard)
export class GateController {
  private readonly deps: GateDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions, placements: [schoolPlacement, academicPlacement] };
  }

  @Get('today')
  today(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return gateToday(this.deps, actorOf(req), Id.parse(i));
  }

  @Get('history')
  history(
    @Query('institutionId') i: string,
    @Query('on') on: string,
    @Query('search') search: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return visitHistory(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      on: Day.parse(on),
      search: (search ?? '').slice(0, 100),
    });
  }

  @Get('visitor')
  visitor(
    @Query('institutionId') i: string,
    @Query('phone') phone: string,
    @Req() req: AuthedRequest,
  ) {
    return visitorByPhone(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      phone: GateMobile.parse(phone),
    }).then((v) => v ?? { name: null, barredReason: null, lastVisits: [] });
  }

  @Get('people')
  people(
    @Query('institutionId') i: string,
    @Query('text') text: string | undefined,
    @Query('kind') kind: string,
    @Req() req: AuthedRequest,
  ) {
    return findPeople(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      text: (text ?? '').slice(0, 100),
      kind: Kind.parse(kind),
    });
  }

  @Post('visits')
  checkIn(@Body() body: unknown, @Req() req: AuthedRequest) {
    return checkIn(this.deps, actorOf(req), GateCheckInInput.parse(body));
  }

  @Post('visits/:id/out')
  @HttpCode(204)
  async checkOut(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await checkOut(this.deps, actorOf(req), {
      visitId: Id.parse(id),
      ...GatePlaceInput.parse(body),
    });
  }

  @Get('expected')
  expected(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return myExpected(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('expected')
  expect(@Body() body: unknown, @Req() req: AuthedRequest) {
    return expectVisitor(this.deps, actorOf(req), GateExpectInput.parse(body));
  }

  @Post('expected/:id/cancel')
  @HttpCode(204)
  async cancelExpected(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await cancelExpected(this.deps, actorOf(req), {
      visitId: Id.parse(id),
      ...GatePlaceInput.parse(body),
    });
  }

  @Get('barred')
  barred(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return barredVisitors(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('barred')
  bar(@Body() body: unknown, @Req() req: AuthedRequest) {
    return barVisitor(this.deps, actorOf(req), GateBarInput.parse(body));
  }

  @Post('barred/:id/lift')
  @HttpCode(204)
  async lift(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await liftBar(this.deps, actorOf(req), {
      visitorId: Id.parse(id),
      ...GateReasonInput.parse(body),
    });
  }

  @Get('pickup')
  pickup(
    @Query('institutionId') i: string,
    @Query('studentId') s: string,
    @Req() req: AuthedRequest,
  ) {
    return pickupOptions(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      studentId: Id.parse(s),
    });
  }

  @Post('passes')
  issuePass(@Body() body: unknown, @Req() req: AuthedRequest) {
    return issuePass(this.deps, actorOf(req), GatePassInput.parse(body));
  }

  @Post('passes/:id/left')
  @HttpCode(204)
  async left(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await passLeft(this.deps, actorOf(req), {
      passId: Id.parse(id),
      ...GatePlaceInput.parse(body),
    });
  }

  @Post('passes/:id/cancel')
  @HttpCode(204)
  async cancelPass(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await cancelPass(this.deps, actorOf(req), {
      passId: Id.parse(id),
      ...GateReasonInput.parse(body),
    });
  }
}
