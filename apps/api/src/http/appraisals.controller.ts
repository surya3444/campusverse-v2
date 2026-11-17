import {
  AppraisalAckInput,
  AppraisalCycleInput,
  AppraisalPlaceInput,
  AppraisalRatingsInput,
  AppraisalReviewerInput,
  Id,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import {
  acknowledge,
  closeCycle,
  cycleReviews,
  cycles,
  myAppraisals,
  openCycle,
  previewOpen,
  review,
  saveCycle,
  setReviewer,
  submitReview,
  submitSelf,
  type AppraisalDeps,
} from '@campusverse/people-appraisals';
import type { Actor } from '@campusverse/platform-permissions';
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

/** Staff appraisals (docs/specs/APPRAISALS.md). */
@Controller('appraisals')
@UseGuards(ActorGuard)
export class AppraisalsController {
  private readonly deps: AppraisalDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get('mine')
  mine(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return myAppraisals(this.deps, actorOf(req), Id.parse(i));
  }

  @Get('cycles')
  cycles(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return cycles(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('cycles')
  addCycle(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveCycle(this.deps, actorOf(req), { id: null, ...AppraisalCycleInput.parse(body) });
  }

  @Put('cycles/:id')
  editCycle(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveCycle(this.deps, actorOf(req), {
      id: Id.parse(id),
      ...AppraisalCycleInput.parse(body),
    });
  }

  @Get('cycles/:id/open')
  preview(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return previewOpen(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      cycleId: Id.parse(id),
    });
  }

  @Post('cycles/:id/open')
  open(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return openCycle(this.deps, actorOf(req), {
      cycleId: Id.parse(id),
      ...AppraisalPlaceInput.parse(body),
    });
  }

  @Post('cycles/:id/close')
  @HttpCode(204)
  async close(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await closeCycle(this.deps, actorOf(req), {
      cycleId: Id.parse(id),
      ...AppraisalPlaceInput.parse(body),
    });
  }

  @Get('cycles/:id/reviews')
  reviews(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return cycleReviews(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      cycleId: Id.parse(id),
    });
  }

  @Get('reviews/:id')
  review(@Param('id') id: string, @Req() req: AuthedRequest) {
    return review(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('reviews/:id/self')
  @HttpCode(204)
  async self(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await submitSelf(this.deps, actorOf(req), {
      reviewId: Id.parse(id),
      ...AppraisalRatingsInput.parse(body),
    });
  }

  @Post('reviews/:id/review')
  rate(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return submitReview(this.deps, actorOf(req), {
      reviewId: Id.parse(id),
      ...AppraisalRatingsInput.parse(body),
    });
  }

  @Post('reviews/:id/acknowledge')
  @HttpCode(204)
  async ack(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await acknowledge(this.deps, actorOf(req), {
      reviewId: Id.parse(id),
      ...AppraisalAckInput.parse(body),
    });
  }

  @Post('reviews/:id/reviewer')
  @HttpCode(204)
  async reviewer(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setReviewer(this.deps, actorOf(req), {
      reviewId: Id.parse(id),
      ...AppraisalReviewerInput.parse(body),
    });
  }
}
