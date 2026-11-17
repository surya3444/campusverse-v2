import {
  HostelAllocateInput,
  HostelInput,
  HostelMoveInput,
  HostelPlaceInput,
  HostelReasonInput,
  HostelRollCallInput,
  HostelRoomInput,
  Id,
  OutpassDecisionInput,
  OutpassIssueInput,
  OutpassRequestInput,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import { academicPlacement } from '@campusverse/academics-structure';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  allocate,
  cancelOutpass,
  childHostel,
  decideOutpass,
  findStudents,
  hostelFigures,
  hostels,
  issueOutpass,
  moveStudent,
  outpassBack,
  outpassLeft,
  outpasses,
  requestOutpass,
  rollCallSheet,
  rooms,
  saveHostel,
  saveRollCall,
  saveRoom,
  vacate,
  type HostelDeps,
} from '@campusverse/shared-hostel';
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
import { z } from 'zod';
import { DB, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};
const Session = z.enum(['night', 'morning']);
const View = z.enum(['requested', 'approved', 'out', 'overdue', 'recent']);

/** The hostel (docs/specs/HOSTEL.md): rooms and beds, roll call, outpasses, the parent's view. */
@Controller('hostel')
@UseGuards(ActorGuard)
export class HostelController {
  private readonly deps: HostelDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions, placements: [schoolPlacement, academicPlacement] };
  }

  @Get('figures')
  figures(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return hostelFigures(this.deps, actorOf(req), Id.parse(i));
  }

  @Get('hostels')
  hostels(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return hostels(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('hostels')
  addHostel(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveHostel(this.deps, actorOf(req), { id: null, ...HostelInput.parse(body) });
  }

  @Put('hostels/:id')
  editHostel(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveHostel(this.deps, actorOf(req), { id: Id.parse(id), ...HostelInput.parse(body) });
  }

  @Get('hostels/:id/rooms')
  rooms(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return rooms(this.deps, actorOf(req), { institutionId: Id.parse(i), hostelId: Id.parse(id) });
  }

  @Post('hostels/:id/rooms')
  addRoom(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveRoom(this.deps, actorOf(req), {
      hostelId: Id.parse(id),
      id: null,
      ...HostelRoomInput.parse(body),
    });
  }

  @Put('hostels/:id/rooms/:roomId')
  editRoom(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    return saveRoom(this.deps, actorOf(req), {
      hostelId: Id.parse(id),
      id: Id.parse(roomId),
      ...HostelRoomInput.parse(body),
    });
  }

  @Get('students')
  students(
    @Query('institutionId') i: string,
    @Query('text') text: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return findStudents(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      text: (text ?? '').slice(0, 100),
    });
  }

  @Post('allocations')
  allocate(@Body() body: unknown, @Req() req: AuthedRequest) {
    return allocate(this.deps, actorOf(req), HostelAllocateInput.parse(body));
  }

  @Post('allocations/:id/move')
  move(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return moveStudent(this.deps, actorOf(req), {
      allocationId: Id.parse(id),
      ...HostelMoveInput.parse(body),
    });
  }

  @Post('allocations/:id/vacate')
  @HttpCode(204)
  async vacate(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await vacate(this.deps, actorOf(req), {
      allocationId: Id.parse(id),
      ...HostelReasonInput.parse(body),
    });
  }

  @Get('hostels/:id/roll-call')
  sheet(
    @Param('id') id: string,
    @Query('institutionId') i: string,
    @Query('session') session: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return rollCallSheet(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      hostelId: Id.parse(id),
      session: Session.parse(session ?? 'night'),
    });
  }

  @Put('hostels/:id/roll-call')
  saveRoll(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveRollCall(this.deps, actorOf(req), {
      hostelId: Id.parse(id),
      ...HostelRollCallInput.parse(body),
    });
  }

  @Get('outpasses')
  outpasses(
    @Query('institutionId') i: string,
    @Query('view') view: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return outpasses(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      view: View.parse(view ?? 'requested'),
    });
  }

  @Post('outpasses')
  issue(@Body() body: unknown, @Req() req: AuthedRequest) {
    return issueOutpass(this.deps, actorOf(req), OutpassIssueInput.parse(body));
  }

  @Post('outpasses/:id/decide')
  @HttpCode(204)
  async decide(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await decideOutpass(this.deps, actorOf(req), {
      outpassId: Id.parse(id),
      ...OutpassDecisionInput.parse(body),
    });
  }

  @Post('outpasses/:id/left')
  @HttpCode(204)
  async left(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await outpassLeft(this.deps, actorOf(req), {
      outpassId: Id.parse(id),
      ...HostelPlaceInput.parse(body),
    });
  }

  @Post('outpasses/:id/back')
  @HttpCode(204)
  async back(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await outpassBack(this.deps, actorOf(req), {
      outpassId: Id.parse(id),
      ...HostelPlaceInput.parse(body),
    });
  }

  /** The parent who asked, or the warden. */
  @Post('outpasses/:id/cancel')
  @HttpCode(204)
  async cancel(@Param('id') id: string, @Req() req: AuthedRequest) {
    await cancelOutpass(this.deps, actorOf(req), { outpassId: Id.parse(id) });
  }

  // The parent app.
  @Get('children/:id')
  child(@Param('id') id: string, @Req() req: AuthedRequest) {
    return childHostel(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('children/outpasses')
  request(@Body() body: unknown, @Req() req: AuthedRequest) {
    return requestOutpass(this.deps, actorOf(req), OutpassRequestInput.parse(body));
  }
}
