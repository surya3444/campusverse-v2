import { Id, NoticeCompose } from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  approveNotice,
  audienceGroups,
  cancelNotice,
  composeNotice,
  listNotices,
  noticeDetail,
  previewNotice,
  sendNotice,
  type NoticeDeps,
} from '@campusverse/shared-communications';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { DB, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';
import { campusAudience } from '../audience.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Notices: compose → approve → preview → send (undo window) → track per guardian and channel. */
@Controller('communications')
@UseGuards(ActorGuard)
export class NoticesController {
  private readonly deps: NoticeDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions, audience: campusAudience };
  }

  @Get(':institutionId/notices')
  list(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return listNotices(this.deps, actorOf(req), Id.parse(id));
  }

  @Get(':institutionId/audience-groups')
  groups(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return audienceGroups(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':institutionId/notices')
  compose(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return composeNotice(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...NoticeCompose.parse(body),
    });
  }

  @Get('notices/:id')
  detail(@Param('id') id: string, @Req() req: AuthedRequest) {
    return noticeDetail(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('notices/:id/approve')
  @HttpCode(204)
  async approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    await approveNotice(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('notices/:id/preview')
  @HttpCode(200)
  preview(@Param('id') id: string, @Req() req: AuthedRequest) {
    return previewNotice(this.deps, actorOf(req), Id.parse(id));
  }

  /** 202: the worker sends once the undo window has passed. */
  @Post('notices/:id/send')
  @HttpCode(202)
  send(@Param('id') id: string, @Req() req: AuthedRequest) {
    return sendNotice(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('notices/:id/cancel')
  @HttpCode(204)
  async cancel(@Param('id') id: string, @Req() req: AuthedRequest) {
    await cancelNotice(this.deps, actorOf(req), Id.parse(id));
  }
}
