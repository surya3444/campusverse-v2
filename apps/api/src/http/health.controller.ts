import {
  HealthBreakGlassInput,
  HealthCloseIncidentInput,
  HealthDiscardInput,
  HealthDispenseInput,
  HealthMedicineInput,
  HealthPartnerInput,
  HealthReceiveInput,
  HealthSosInput,
  HealthPlaceInput,
  HealthRecordInput,
  HealthVisitInput,
  Id,
} from '@campusverse/contracts';
import type { Actor } from '@campusverse/platform-permissions';
import {
  closeIncident,
  discardStock,
  dispense,
  emergencyPartners,
  incidentReport,
  incidents,
  medicineDetail,
  medicines,
  raiseSos,
  receiveStock,
  saveMedicine,
  savePartner,
  healthRecord,
  healthTotals,
  openBreakGlass,
  recordVisit,
  saveHealthRecord,
  visitsToday,
  type HealthDeps,
} from '@campusverse/shared-health';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { HEALTH, type AuthedRequest } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Health Connect (rule book §13.9): the vault, sick-room visits, totals and break-glass. */
@Controller('health')
@UseGuards(ActorGuard)
export class StudentHealthController {
  constructor(@Inject(HEALTH) private readonly deps: HealthDeps) {}

  @Get('totals')
  totals(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return healthTotals(
      this.deps,
      actorOf(req),
      HealthPlaceInput.parse({ institutionId: i }).institutionId,
    );
  }

  @Get('visits')
  visits(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return visitsToday(
      this.deps,
      actorOf(req),
      HealthPlaceInput.parse({ institutionId: i }).institutionId,
    );
  }

  @Get('students/:id')
  record(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return healthRecord(this.deps, actorOf(req), {
      studentId: Id.parse(id),
      institutionId: HealthPlaceInput.parse({ institutionId: i }).institutionId,
    });
  }

  @Put('students/:id')
  @HttpCode(204)
  async save(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await saveHealthRecord(this.deps, actorOf(req), {
      studentId: Id.parse(id),
      ...HealthRecordInput.parse(body),
    });
  }

  @Post('students/:id/visits')
  visit(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const v = HealthVisitInput.parse(body);
    return recordVisit(this.deps, actorOf(req), {
      studentId: Id.parse(id),
      institutionId: v.institutionId,
      notes: { complaint: v.complaint, care: v.care },
      outcome: v.outcome,
      parentTold: v.parentTold,
    });
  }

  /** Break-glass: recorded for ever, expires in an hour, tells the Data Protection Officer. */
  @Post('students/:id/emergency')
  emergency(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return openBreakGlass(this.deps, actorOf(req), {
      studentId: Id.parse(id),
      ...HealthBreakGlassInput.parse(body),
    });
  }

  // Medicines & Stock: the medical role.
  @Get('medicines')
  medicines(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return medicines(
      this.deps,
      actorOf(req),
      HealthPlaceInput.parse({ institutionId: i }).institutionId,
    );
  }

  @Get('medicines/:id')
  medicine(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return medicineDetail(this.deps, actorOf(req), {
      medicineId: Id.parse(id),
      institutionId: HealthPlaceInput.parse({ institutionId: i }).institutionId,
    });
  }

  @Post('medicines')
  addMedicine(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveMedicine(this.deps, actorOf(req), HealthMedicineInput.parse(body));
  }

  @Put('medicines/:id')
  updateMedicine(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveMedicine(this.deps, actorOf(req), {
      id: Id.parse(id),
      ...HealthMedicineInput.parse(body),
    });
  }

  @Post('medicines/:id/receive')
  receive(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return receiveStock(this.deps, actorOf(req), {
      medicineId: Id.parse(id),
      ...HealthReceiveInput.parse(body),
    });
  }

  @Post('medicines/:id/dispense')
  @HttpCode(204)
  async give(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await dispense(this.deps, actorOf(req), {
      medicineId: Id.parse(id),
      ...HealthDispenseInput.parse(body),
    });
  }

  @Post('stock/discard')
  @HttpCode(204)
  async discard(@Body() body: unknown, @Req() req: AuthedRequest) {
    await discardStock(this.deps, actorOf(req), HealthDiscardInput.parse(body));
  }

  // Emergency: SOS from any staff member; incidents and partners for those who manage them.
  @Post('sos')
  sos(@Body() body: unknown, @Req() req: AuthedRequest) {
    return raiseSos(this.deps, actorOf(req), HealthSosInput.parse(body));
  }

  @Get('partners')
  partners(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return emergencyPartners(
      this.deps,
      actorOf(req),
      HealthPlaceInput.parse({ institutionId: i }).institutionId,
    );
  }

  @Post('partners')
  addPartner(@Body() body: unknown, @Req() req: AuthedRequest) {
    return savePartner(this.deps, actorOf(req), HealthPartnerInput.parse(body));
  }

  @Put('partners/:id')
  updatePartner(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return savePartner(this.deps, actorOf(req), {
      id: Id.parse(id),
      ...HealthPartnerInput.parse(body),
    });
  }

  @Get('incidents')
  incidents(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return incidents(
      this.deps,
      actorOf(req),
      HealthPlaceInput.parse({ institutionId: i }).institutionId,
    );
  }

  @Get('incidents/:id/report')
  report(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return incidentReport(this.deps, actorOf(req), {
      incidentId: Id.parse(id),
      institutionId: HealthPlaceInput.parse({ institutionId: i }).institutionId,
    });
  }

  @Post('incidents/:id/close')
  @HttpCode(204)
  async close(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await closeIncident(this.deps, actorOf(req), {
      incidentId: Id.parse(id),
      ...HealthCloseIncidentInput.parse(body),
    });
  }
}
