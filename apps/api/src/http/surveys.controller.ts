import { Id } from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  AUDIENCES,
  SURVEY_KINDS,
  addAction,
  completeAction,
  createSurvey,
  setQuestions,
  setSurveyState,
  submitResponse,
  surveyResults,
  surveys,
  surveysToAnswer,
  type SurveyDeps,
} from '@campusverse/shared-surveys';
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
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Place = z.object({ institutionId: Id });
const Create = Place.extend({
  kind: z.enum(SURVEY_KINDS),
  title: z.string().trim().min(3).max(160),
  audience: z.enum(AUDIENCES),
  anonymous: z.boolean().default(true),
  opensOn: Day,
  closesOn: Day,
}).refine((v) => v.closesOn >= v.opensOn, { path: ['closesOn'], message: 'closes_before_opens' });
const Questions = Place.extend({
  questions: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('rating'),
          prompt: z.string().trim().min(3).max(300),
          weight: z.number().min(0).max(10).default(1),
          options: z.array(z.string()).max(0).default([]),
        }),
        z.object({
          kind: z.literal('choice'),
          prompt: z.string().trim().min(3).max(300),
          weight: z.literal(0).default(0),
          options: z.array(z.string().trim().min(1).max(200)).min(2).max(10),
        }),
        z.object({
          kind: z.literal('text'),
          prompt: z.string().trim().min(3).max(300),
          weight: z.literal(0).default(0),
          options: z.array(z.string()).max(0).default([]),
        }),
      ]),
    )
    .min(1)
    .max(40),
});
const State = Place.extend({ state: z.enum(['open', 'closed']) });
const Respond = Place.extend({
  answers: z.record(
    Id,
    z.object({
      rating: z.number().int().min(1).max(5).nullish(),
      choice: z.string().max(200).nullish(),
      text: z.string().max(2000).nullish(),
    }),
  ),
});
const Action = Place.extend({
  title: z.string().trim().min(3).max(300),
  ownerId: Id,
  dueOn: Day,
});
const Done = Place.extend({ outcome: z.string().trim().min(3).max(2000) });

/** Academics › Feedback & Surveys (rule book §13.4). */
@Controller('surveys')
@UseGuards(ActorGuard)
export class SurveysController {
  private readonly deps: SurveyDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get()
  list(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return surveys(this.deps, actorOf(req), Id.parse(i));
  }

  @Post()
  create(@Body() body: unknown, @Req() req: AuthedRequest) {
    return createSurvey(this.deps, actorOf(req), Create.parse(body));
  }

  @Get('to-answer')
  toAnswer(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return surveysToAnswer(this.deps, actorOf(req), Id.parse(i));
  }

  @Put(':id/questions')
  @HttpCode(204)
  async questions(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setQuestions(this.deps, actorOf(req), {
      surveyId: Id.parse(id),
      ...Questions.parse(body),
    });
  }

  @Post(':id/state')
  @HttpCode(204)
  async state(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setSurveyState(this.deps, actorOf(req), { surveyId: Id.parse(id), ...State.parse(body) });
  }

  @Post(':id/responses')
  @HttpCode(204)
  async respond(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await submitResponse(this.deps, actorOf(req), {
      surveyId: Id.parse(id),
      ...Respond.parse(body),
    });
  }

  @Get(':id/results')
  results(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return surveyResults(this.deps, actorOf(req), {
      surveyId: Id.parse(id),
      institutionId: Id.parse(i),
    });
  }

  @Post(':id/actions')
  action(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return addAction(this.deps, actorOf(req), { surveyId: Id.parse(id), ...Action.parse(body) });
  }

  @Post('actions/:id/done')
  @HttpCode(204)
  async done(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await completeAction(this.deps, actorOf(req), { actionId: Id.parse(id), ...Done.parse(body) });
  }
}
