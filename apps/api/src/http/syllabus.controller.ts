import {
  Day,
  Id,
  LessonPlanInput,
  SyllabusMoveInput,
  SyllabusPlaceInput,
  SyllabusTickInput,
  SyllabusUnitInput,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  classSubjects,
  commitCopy,
  deleteUnit,
  lessonPlans,
  moveUnit,
  previewCopy,
  saveLessonPlan,
  saveUnit,
  schoolCoverage,
  syllabusFigures,
  syllabusPlan,
  tickUnit,
  type SyllabusDeps,
} from '@campusverse/school-syllabus';
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
import { DB, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Syllabus and lesson plans (docs/specs/SYLLABUS.md). */
@Controller('school/syllabus')
@UseGuards(ActorGuard)
export class SyllabusController {
  private readonly deps: SyllabusDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get('figures')
  figures(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return syllabusFigures(this.deps, actorOf(req), Id.parse(i));
  }

  @Get('classes')
  classes(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return classSubjects(this.deps, actorOf(req), Id.parse(i));
  }

  @Get('plan')
  plan(
    @Query('institutionId') i: string,
    @Query('classId') classId: string,
    @Query('subjectId') subjectId: string,
    @Req() req: AuthedRequest,
  ) {
    return syllabusPlan(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      classId: Id.parse(classId),
      subjectId: Id.parse(subjectId),
    });
  }

  @Get('coverage')
  coverage(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return schoolCoverage(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('units')
  addUnit(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveUnit(this.deps, actorOf(req), { id: null, ...SyllabusUnitInput.parse(body) });
  }

  @Put('units/:id')
  editUnit(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveUnit(this.deps, actorOf(req), {
      id: Id.parse(id),
      ...SyllabusUnitInput.parse(body),
    });
  }

  @Post('units/:id/move')
  @HttpCode(204)
  async move(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await moveUnit(this.deps, actorOf(req), {
      unitId: Id.parse(id),
      ...SyllabusMoveInput.parse(body),
    });
  }

  @Post('units/:id/delete')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await deleteUnit(this.deps, actorOf(req), {
      unitId: Id.parse(id),
      ...SyllabusPlaceInput.parse(body),
    });
  }

  @Post('units/:id/tick')
  @HttpCode(204)
  async tick(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await tickUnit(this.deps, actorOf(req), {
      unitId: Id.parse(id),
      ...SyllabusTickInput.parse(body),
    });
  }

  @Get('lesson-plans')
  plans(
    @Query('institutionId') i: string,
    @Query('sectionId') sectionId: string,
    @Query('subjectId') subjectId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req: AuthedRequest,
  ) {
    return lessonPlans(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      sectionId: Id.parse(sectionId),
      subjectId: Id.parse(subjectId),
      from: Day.parse(from),
      to: Day.parse(to),
    });
  }

  @Put('lesson-plans')
  savePlan(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveLessonPlan(this.deps, actorOf(req), LessonPlanInput.parse(body));
  }

  @Get('copy')
  preview(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return previewCopy(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('copy')
  commit(@Body() body: unknown, @Req() req: AuthedRequest) {
    return commitCopy(this.deps, actorOf(req), SyllabusPlaceInput.parse(body).institutionId);
  }
}
