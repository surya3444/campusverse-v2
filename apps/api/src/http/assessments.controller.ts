import { Id } from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  BLOOM,
  DIFFICULTIES,
  QUESTION_KINDS,
  archiveQuestion,
  createPaper,
  finalisePaper,
  paperDetail,
  papers,
  questions,
  saveQuestion,
  setPaperQuestions,
  subjects,
  type AssessmentDeps,
} from '@campusverse/shared-assessments';
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
const Place = z.object({ institutionId: Id });
const Subject = z.string().trim().min(2).max(80);
const Question = Place.extend({
  subject: Subject,
  topic: z.string().trim().max(120).nullable().default(null),
  kind: z.enum(QUESTION_KINDS),
  prompt: z.string().trim().min(3).max(4000),
  options: z.array(z.string().trim().max(500)).max(6).default([]),
  answer: z.string().max(4000).nullable().default(null),
  marks: z.number().positive().max(100).multipleOf(0.25),
  difficulty: z.enum(DIFFICULTIES),
  bloom: z.enum(BLOOM),
  coCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.-]{0,20}$/)
    .nullable()
    .default(null),
});
const Filter = Place.extend({
  subject: Subject.optional(),
  bloom: z.enum(BLOOM).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  search: z.string().max(100).optional(),
});
const Paper = Place.extend({
  title: z.string().trim().min(3).max(160),
  subject: Subject,
  minutes: z.number().int().min(5).max(600).nullable().default(null),
  instructions: z.string().max(2000).nullable().default(null),
});
const Items = Place.extend({ questionIds: z.array(Id).max(200) });

/** Academics › Assessments (rule book §13.2). */
@Controller('assessments')
@UseGuards(ActorGuard)
export class AssessmentsController {
  private readonly deps: AssessmentDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get('subjects')
  subjects(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return subjects(this.deps, actorOf(req), Id.parse(i));
  }

  @Get('questions')
  questions(@Query() query: unknown, @Req() req: AuthedRequest) {
    return questions(this.deps, actorOf(req), Filter.parse(query));
  }

  @Post('questions')
  add(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveQuestion(this.deps, actorOf(req), Question.parse(body));
  }

  @Put('questions/:id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveQuestion(this.deps, actorOf(req), { id: Id.parse(id), ...Question.parse(body) });
  }

  @Post('questions/:id/archive')
  @HttpCode(204)
  async archive(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await archiveQuestion(this.deps, actorOf(req), { id: Id.parse(id), ...Place.parse(body) });
  }

  @Get('papers')
  papers(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return papers(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('papers')
  createPaper(@Body() body: unknown, @Req() req: AuthedRequest) {
    return createPaper(this.deps, actorOf(req), Paper.parse(body));
  }

  @Get('papers/:id')
  paper(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return paperDetail(this.deps, actorOf(req), {
      paperId: Id.parse(id),
      institutionId: Id.parse(i),
    });
  }

  @Put('papers/:id/questions')
  @HttpCode(204)
  async items(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setPaperQuestions(this.deps, actorOf(req), {
      paperId: Id.parse(id),
      ...Items.parse(body),
    });
  }

  @Post('papers/:id/finalise')
  @HttpCode(204)
  async finalise(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await finalisePaper(this.deps, actorOf(req), { paperId: Id.parse(id), ...Place.parse(body) });
  }
}
