import {
  CopyTimetableInput,
  CoverInput,
  GenerateInput,
  GenerateRules,
  GroupInput,
  GroupSlotInput,
  Id,
  NewTimetableInput,
  PublishTimetableInput,
  ScheduleInput,
  SlotInput,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  assignCover,
  cancelCover,
  copyTimetable,
  coverDay,
  createTimetable,
  dayPlan,
  generation,
  placeGeneration,
  requestGeneration,
  saveRules,
  deleteGroup,
  listTimetables,
  publishTimetable,
  saveGroup,
  setGroupSlot,
  setSlot,
  timetableDetail,
  updateSchedule,
} from '@campusverse/school-timetable';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Delete,
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

/** The school timetable (Milestone 19): versions, the grid editor, publishing, a day's lessons. */
@Controller('school/timetable')
@UseGuards(ActorGuard)
export class TimetableController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
  ) {}

  @Get()
  list(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return listTimetables(this.db, this.permissions, actorOf(req), Id.parse(institutionId));
  }

  @Get('day')
  day(
    @Query('institutionId') institutionId: string,
    @Query('date') date: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return dayPlan(this.db, this.permissions, actorOf(req), {
      institutionId: Id.parse(institutionId),
      ...(date ? { date: z.iso.date().parse(date) } : {}),
    });
  }

  @Get('cover')
  cover(
    @Query('institutionId') institutionId: string,
    @Query('date') date: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return coverDay(this.db, this.permissions, actorOf(req), {
      institutionId: Id.parse(institutionId),
      ...(date ? { date: z.iso.date().parse(date) } : {}),
    });
  }

  @Post('cover')
  assign(@Body() body: unknown, @Req() req: AuthedRequest) {
    return assignCover(this.db, this.permissions, actorOf(req), CoverInput.parse(body));
  }

  @Post('cover/:id/cancel')
  @HttpCode(204)
  async cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await cancelCover(this.db, this.permissions, actorOf(req), {
      institutionId: z.object({ institutionId: Id }).parse(body).institutionId,
      coverId: Id.parse(id),
    });
  }

  @Get(':id')
  detail(@Param('id') id: string, @Req() req: AuthedRequest) {
    return timetableDetail(this.db, this.permissions, actorOf(req), Id.parse(id));
  }

  @Post()
  create(@Body() body: unknown, @Req() req: AuthedRequest) {
    return createTimetable(this.db, this.permissions, actorOf(req), NewTimetableInput.parse(body));
  }

  @Put(':id/schedule')
  @HttpCode(204)
  async schedule(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await updateSchedule(this.db, this.permissions, actorOf(req), {
      ...ScheduleInput.parse(body),
      timetableId: Id.parse(id),
    });
  }

  @Post(':id/copy')
  copy(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return copyTimetable(this.db, this.permissions, actorOf(req), {
      ...CopyTimetableInput.parse(body),
      timetableId: Id.parse(id),
    });
  }

  @Put(':id/slots')
  @HttpCode(204)
  async slot(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setSlot(this.db, this.permissions, actorOf(req), {
      ...SlotInput.parse(body),
      timetableId: Id.parse(id),
    });
  }

  @Post(':id/publish')
  @HttpCode(204)
  async publish(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await publishTimetable(this.db, this.permissions, actorOf(req), {
      ...PublishTimetableInput.parse(body),
      timetableId: Id.parse(id),
    });
  }

  @Post(':id/groups')
  addGroup(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveGroup(this.db, this.permissions, actorOf(req), {
      ...GroupInput.parse(body),
      timetableId: Id.parse(id),
    });
  }

  @Put(':id/groups/:groupId')
  @HttpCode(204)
  async editGroup(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await saveGroup(this.db, this.permissions, actorOf(req), {
      ...GroupInput.parse(body),
      timetableId: Id.parse(id),
      groupId: Id.parse(groupId),
    });
  }

  @Delete(':id/groups/:groupId')
  @HttpCode(204)
  async removeGroup(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Req() req: AuthedRequest,
  ) {
    await deleteGroup(this.db, this.permissions, actorOf(req), {
      timetableId: Id.parse(id),
      groupId: Id.parse(groupId),
    });
  }

  @Put(':id/groups/:groupId/slots')
  @HttpCode(204)
  async groupSlot(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await setGroupSlot(this.db, this.permissions, actorOf(req), {
      ...GroupSlotInput.parse(body),
      timetableId: Id.parse(id),
      groupId: Id.parse(groupId),
    });
  }

  @Put(':id/rules')
  @HttpCode(204)
  async rules(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await saveRules(this.db, this.permissions, actorOf(req), {
      timetableId: Id.parse(id),
      rules: GenerateRules.parse(body),
    });
  }

  /** Starts generating (the worker searches); follow it on GET …/generate/:runId. */
  @Post(':id/generate')
  @HttpCode(202)
  generate(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { rules } = GenerateInput.parse(body ?? {});
    return requestGeneration(this.db, this.permissions, actorOf(req), {
      timetableId: Id.parse(id),
      rules,
    });
  }

  @Get(':id/generate/:runId')
  run(@Param('id') id: string, @Param('runId') runId: string, @Req() req: AuthedRequest) {
    return generation(this.db, this.permissions, actorOf(req), {
      timetableId: Id.parse(id),
      generationId: Id.parse(runId),
    });
  }

  @Post(':id/generate/:runId/place')
  place(@Param('id') id: string, @Param('runId') runId: string, @Req() req: AuthedRequest) {
    return placeGeneration(this.db, this.permissions, actorOf(req), {
      timetableId: Id.parse(id),
      generationId: Id.parse(runId),
    });
  }
}
