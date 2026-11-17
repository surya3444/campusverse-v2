import {
  CourseOutcomesInput,
  Id,
  OutcomeSetDraftInput,
  OutcomeSetInput,
} from '@campusverse/contracts';
import {
  attainment,
  courseOutcomes,
  draftOutcomeSet,
  outcomeSets,
  publishOutcomeSet,
  saveCourseOutcomes,
  saveOutcomeSet,
  type ObeDeps,
} from '@campusverse/academics-obe';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
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

/** Academics › OBE (rule book §13.2; P1 item 17): outcomes, COs and the matrix, attainment. */
@Controller('academics')
@UseGuards(ActorGuard)
export class ObeController {
  private readonly deps: ObeDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get('programs/:id/outcome-sets')
  sets(@Param('id') id: string, @Req() req: AuthedRequest) {
    return outcomeSets(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('programs/:id/outcome-sets')
  async draft(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await draftOutcomeSet(this.deps, actorOf(req), {
        programId: Id.parse(id),
        ...OutcomeSetDraftInput.parse(body),
      }),
    };
  }

  @Post('outcome-sets/:id')
  @HttpCode(204)
  async save(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await saveOutcomeSet(this.deps, actorOf(req), {
      setId: Id.parse(id),
      ...OutcomeSetInput.parse(body),
    });
  }

  @Post('outcome-sets/:id/publish')
  @HttpCode(204)
  async publish(@Param('id') id: string, @Req() req: AuthedRequest) {
    await publishOutcomeSet(this.deps, actorOf(req), Id.parse(id));
  }

  @Get('regulations/:id/courses/:courseId/outcomes')
  course(@Param('id') id: string, @Param('courseId') courseId: string, @Req() req: AuthedRequest) {
    return courseOutcomes(this.deps, actorOf(req), {
      regulationId: Id.parse(id),
      courseId: Id.parse(courseId),
    });
  }

  @Post('regulations/:id/courses/:courseId/outcomes')
  @HttpCode(204)
  async saveCourse(
    @Param('id') id: string,
    @Param('courseId') courseId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await saveCourseOutcomes(this.deps, actorOf(req), {
      regulationId: Id.parse(id),
      courseId: Id.parse(courseId),
      ...CourseOutcomesInput.parse(body),
    });
  }

  @Get('batches/:id/attainment')
  attainment(@Param('id') id: string, @Query('term') term: string, @Req() req: AuthedRequest) {
    return attainment(this.deps, actorOf(req), {
      batchId: Id.parse(id),
      term: z.coerce.number().int().min(1).max(16).parse(term),
    });
  }
}
