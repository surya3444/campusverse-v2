import {
  EndRiderInput,
  EndTripInput,
  PositionsInput,
  SosInput,
  Id,
  RiderImportInput,
  RiderInput,
  RouteInput,
  StartTripInput,
  StopInput,
  VehicleDocumentInput,
  VehicleInput,
  ZoneFeeInput,
} from '@campusverse/contracts';
import { billStudent, groupFees, setGroupFee, type FinanceDeps } from '@campusverse/shared-finance';
import { academicPlacement } from '@campusverse/academics-structure';
import { schoolPlacement } from '@campusverse/school-enrolment';
import { z } from 'zod';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  addVehicleDocument,
  assignRider,
  commitRiderImport,
  endRider,
  endTrip,
  listRiders,
  boardingLog,
  previewRiderImport,
  ridership,
  raiseSos,
  recordPositions,
  saveRoute,
  saveStop,
  saveVehicle,
  startTrip,
  todayTrips,
  tripSheet,
  transportSetup,
  type BillRider,
} from '@campusverse/shared-transport';
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
import { DB, FINANCE, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

// Labels and admission numbers for riders come from each academic module's placement port.
const PLACEMENTS = [schoolPlacement, academicPlacement];

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Transport setup (Milestone 18 step 1): vehicles, documents, stops, routes. */
@Controller('transport')
@UseGuards(ActorGuard)
export class TransportController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
    @Inject(FINANCE) private readonly finance: FinanceDeps,
  ) {}

  /** A new rider is billed on every published plan that covers them, in the same transaction. */
  private readonly bill: BillRider = (tx, input) => billStudent(tx, this.finance.audience, input);

  @Get('setup')
  setup(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return transportSetup(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  @Post('vehicles')
  vehicle(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveVehicle(this.db, this.permissions, actorOf(req), VehicleInput.parse(body));
  }

  @Post('vehicles/:id/documents')
  @HttpCode(204)
  async document(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await addVehicleDocument(this.db, this.permissions, actorOf(req), {
      ...VehicleDocumentInput.parse(body),
      vehicleId: Id.parse(id),
    });
  }

  @Post('stops')
  stop(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveStop(this.db, this.permissions, actorOf(req), StopInput.parse(body));
  }

  @Post('routes')
  route(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveRoute(this.db, this.permissions, actorOf(req), RouteInput.parse(body));
  }

  /** Each fare zone's published fee (finance owns plans; transport owns the zones). */
  @Get('zone-fees')
  zoneFees(
    @Query('institutionId') institutionId: string,
    @Query('zoneIds') zoneIds: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    const ids = (zoneIds ?? '')
      .split(',')
      .filter(Boolean)
      .slice(0, 20)
      .map((z) => Id.parse(z));
    return groupFees(this.finance, actorOf(req), Id.parse(institutionId), ids);
  }

  /**
   * Sets a fare zone's yearly fee from the Transport screen: the Transport head (added if
   * missing; not waived for RTE students, decision in CONNECTED_SCHOOL.md), a new plan version,
   * published, in one transaction.
   */
  @Post('zones/:zoneId/fee')
  zoneFee(@Param('zoneId') zoneId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = ZoneFeeInput.parse(body);
    return setGroupFee(this.finance, actorOf(req), {
      institutionId: input.institutionId,
      groupId: Id.parse(zoneId),
      name: '',
      head: { code: 'TRANSPORT', name: 'Transport', rteExempt: false },
      amountPaise: input.amountPaise,
      instalments: input.instalments,
    });
  }

  @Get('riders')
  riders(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return listRiders(this.db, this.permissions, PLACEMENTS, actorOf(req), Id.parse(institutionId));
  }

  @Post('riders')
  assign(@Body() body: unknown, @Req() req: AuthedRequest) {
    return assignRider(
      this.db,
      this.permissions,
      PLACEMENTS,
      actorOf(req),
      RiderInput.parse(body),
      this.bill,
    );
  }

  @Post('riders/:id/end')
  @HttpCode(204)
  async end(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await endRider(this.db, this.permissions, actorOf(req), {
      ...EndRiderInput.parse(body),
      assignmentId: Id.parse(id),
    });
  }

  @Post('riders/import/preview')
  @HttpCode(200)
  preview(@Body() body: unknown, @Req() req: AuthedRequest) {
    return previewRiderImport(
      this.db,
      this.permissions,
      PLACEMENTS,
      actorOf(req),
      RiderImportInput.parse(body),
    );
  }

  @Post('riders/import')
  commit(@Body() body: unknown, @Req() req: AuthedRequest) {
    return commitRiderImport(
      this.db,
      this.permissions,
      PLACEMENTS,
      actorOf(req),
      RiderImportInput.parse(body),
      this.bill,
    );
  }

  @Get('trips')
  trips(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return todayTrips(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  @Get('reports/boarding')
  boarding(
    @Query('institutionId') institutionId: string,
    @Query('date') date: string,
    @Req() req: AuthedRequest,
  ) {
    return boardingLog(this.db, this.permissions, PLACEMENTS, actorOf(req), {
      institutionId: Id.parse(institutionId),
      date: z.iso.date().parse(date),
    });
  }

  @Get('reports/ridership')
  ridership(
    @Query('institutionId') institutionId: string,
    @Query('month') month: string,
    @Req() req: AuthedRequest,
  ) {
    return ridership(this.db, this.permissions, actorOf(req), {
      institutionId: Id.parse(institutionId),
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .parse(month),
    });
  }

  @Get('trips/sheet')
  sheet(
    @Query('institutionId') institutionId: string,
    @Query('routeId') routeId: string,
    @Req() req: AuthedRequest,
  ) {
    return tripSheet(this.db, this.permissions, PLACEMENTS, actorOf(req), {
      institutionId: Id.parse(institutionId),
      routeId: Id.parse(routeId),
    });
  }

  @Post('trips')
  start(@Body() body: unknown, @Req() req: AuthedRequest) {
    return startTrip(this.db, this.permissions, actorOf(req), StartTripInput.parse(body));
  }

  @Post('trips/:id/end')
  @HttpCode(204)
  async endTrip(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await endTrip(this.db, this.permissions, actorOf(req), {
      ...EndTripInput.parse(body),
      tripId: Id.parse(id),
    });
  }

  @Post('trips/:id/positions')
  positions(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return recordPositions(this.db, this.permissions, actorOf(req), {
      ...PositionsInput.parse(body),
      tripId: Id.parse(id),
    });
  }

  @Post('trips/:id/sos')
  @HttpCode(204)
  async sos(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await raiseSos(this.db, this.permissions, actorOf(req), {
      ...SosInput.parse(body),
      tripId: Id.parse(id),
    });
  }
}
