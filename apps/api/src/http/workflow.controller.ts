import { ApprovalStepsInput, Id } from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  approvalDesign,
  myDecisions,
  myWork,
  saveApprovalSteps,
  type WorkflowDeps,
} from '@campusverse/platform-workflow';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
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

/** Campus Core › Workflow & Approvals (rule book §12.4 decision 6): My Work and the designer. */
@Controller('workflow')
@UseGuards(ActorGuard)
export class WorkflowController {
  private readonly deps: WorkflowDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get('my-work')
  work(@Req() req: AuthedRequest) {
    return myWork(this.deps, actorOf(req));
  }

  /** What the signed-in person decided lately (My Work › Decided by me). */
  @Get('my-decisions')
  decisions(@Req() req: AuthedRequest) {
    return myDecisions(this.deps, actorOf(req));
  }

  @Get('design')
  design(@Query('institutionId') institutionId: string | undefined, @Req() req: AuthedRequest) {
    return approvalDesign(this.deps, actorOf(req), institutionId ? Id.parse(institutionId) : null);
  }

  @Post('design')
  @HttpCode(204)
  async save(@Body() body: unknown, @Req() req: AuthedRequest) {
    await saveApprovalSteps(this.deps, actorOf(req), ApprovalStepsInput.parse(body));
  }
}
