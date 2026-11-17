import {
  ExamCreate,
  Id,
  MarkChange,
  MarksSave,
  PaperScheduleInput,
  RemarkInput,
  RolloverCommit,
  SectionPlanInput,
  YearSpan,
} from '@campusverse/contracts';
import type { Actor } from '@campusverse/platform-permissions';
import {
  createExam,
  dateSheet,
  examAnalysis,
  schedulePaper,
  decideMarkChange,
  examDetail,
  listExams,
  lockExam,
  marksSheet,
  publishExam,
  requestMarkChange,
  saveMarks,
  setRemark,
  studentResults,
  submitPaper,
  type ExamDeps,
} from '@campusverse/school-exams';
import {
  commitRollover,
  listRollovers,
  previewRollover,
  saveSectionPlan,
  sectionPlan,
  undoRollover,
  type RolloverDeps,
} from '@campusverse/school-rollover';
import { classesOf, yearsOf } from '@campusverse/school-setup';
import { withTenant } from '@campusverse/db';
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
import { EXAMS, ROLLOVER, type AuthedRequest } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Exams: papers, marks, locks, changes after the lock, publishing with report cards. */
@Controller('school/exams')
@UseGuards(ActorGuard)
export class ExamsController {
  constructor(@Inject(EXAMS) private readonly deps: ExamDeps) {}

  @Get('institution/:institutionId')
  list(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return listExams(this.deps, actorOf(req), Id.parse(id));
  }

  /** The institution's years and classes, for the exam and rollover forms. */
  @Get('institution/:institutionId/years')
  async years(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    await listExams(this.deps, actor, Id.parse(id)); // same permission as reading exams
    return withTenant(this.deps.db, actor.orgId, async (tx) => ({
      years: await yearsOf(tx, Id.parse(id)),
      classes: await classesOf(tx, Id.parse(id)),
    }));
  }

  @Post('institution/:institutionId')
  create(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return createExam(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...ExamCreate.parse(body),
    });
  }

  @Get(':id/date-sheet')
  dateSheet(@Param('id') id: string, @Req() req: AuthedRequest) {
    return dateSheet(this.deps, actorOf(req), Id.parse(id));
  }

  @Get(':id/analysis')
  analysis(@Param('id') id: string, @Req() req: AuthedRequest) {
    return examAnalysis(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('papers/:paperId/schedule')
  @HttpCode(204)
  async schedule(
    @Param('paperId') paperId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await schedulePaper(this.deps, actorOf(req), Id.parse(paperId), PaperScheduleInput.parse(body));
  }

  @Get(':id')
  detail(@Param('id') id: string, @Req() req: AuthedRequest) {
    return examDetail(this.deps, actorOf(req), Id.parse(id));
  }

  @Get('papers/:paperId')
  sheet(
    @Param('paperId') paperId: string,
    @Query('sectionId') sectionId: string,
    @Req() req: AuthedRequest,
  ) {
    return marksSheet(this.deps, actorOf(req), {
      paperId: Id.parse(paperId),
      sectionId: Id.parse(sectionId),
    });
  }

  @Post('papers/:paperId/marks')
  save(@Param('paperId') paperId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveMarks(this.deps, actorOf(req), {
      paperId: Id.parse(paperId),
      ...MarksSave.parse(body),
    });
  }

  @Post('papers/:paperId/submit')
  @HttpCode(204)
  async submit(@Param('paperId') paperId: string, @Req() req: AuthedRequest) {
    await submitPaper(this.deps, actorOf(req), Id.parse(paperId));
  }

  @Post('papers/:paperId/changes')
  change(@Param('paperId') paperId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return requestMarkChange(this.deps, actorOf(req), {
      paperId: Id.parse(paperId),
      ...MarkChange.parse(body),
    });
  }

  @Post('changes/:id/decide')
  @HttpCode(204)
  async decide(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await decideMarkChange(this.deps, actorOf(req), {
      changeId: Id.parse(id),
      ...z.object({ approve: z.boolean() }).parse(body),
    });
  }

  @Post(':id/remarks')
  @HttpCode(204)
  async remark(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setRemark(this.deps, actorOf(req), { examId: Id.parse(id), ...RemarkInput.parse(body) });
  }

  @Post(':id/lock')
  @HttpCode(204)
  async lock(@Param('id') id: string, @Req() req: AuthedRequest) {
    await lockExam(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Req() req: AuthedRequest) {
    return publishExam(this.deps, actorOf(req), Id.parse(id));
  }

  @Get('students/:studentId/results')
  results(@Param('studentId') id: string, @Req() req: AuthedRequest) {
    return studentResults(this.deps, actorOf(req), Id.parse(id));
  }
}

/** Year end: the section planner, preview, commit and undo. */
@Controller('school/rollover')
@UseGuards(ActorGuard)
export class RolloverController {
  constructor(@Inject(ROLLOVER) private readonly deps: RolloverDeps) {}

  @Get(':institutionId')
  list(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return listRollovers(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':institutionId/preview')
  @HttpCode(200)
  preview(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return previewRollover(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...YearSpan.parse(body),
    });
  }

  @Post(':institutionId/plan')
  @HttpCode(200)
  plan(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const b = YearSpan.extend({
      classId: z.uuid(),
      regenerate: z.boolean().optional(),
      keepApart: z
        .array(z.tuple([z.uuid(), z.uuid()]))
        .max(100)
        .optional(),
    }).parse(body);
    return sectionPlan(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...b,
      ...(b.keepApart ? { keepApart: b.keepApart } : {}),
      ...(b.regenerate ? { regenerate: true } : {}),
    });
  }

  @Post(':institutionId/plan/save')
  savePlan(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveSectionPlan(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...SectionPlanInput.parse(body),
    });
  }

  @Post(':institutionId/commit')
  commit(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return commitRollover(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...RolloverCommit.parse(body),
    });
  }

  @Post('runs/:rolloverId/undo')
  @HttpCode(204)
  async undo(@Param('rolloverId') id: string, @Req() req: AuthedRequest) {
    await undoRollover(this.deps, actorOf(req), Id.parse(id));
  }
}
