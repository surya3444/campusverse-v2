import { Id, LanguageInput, PushTokenInput, SkipRideInput } from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import { myChildren, type PeopleDeps } from '@campusverse/people-records';
import type { Actor } from '@campusverse/platform-permissions';
import { childDay } from '@campusverse/school-attendance';
import { academicPlacement } from '@campusverse/academics-structure';
import { schoolPlacement } from '@campusverse/school-enrolment';
import { childWeek } from '@campusverse/school-timetable';
import { childBus, skipRide } from '@campusverse/shared-transport';
import {
  acknowledge,
  markRead,
  myLanguage,
  myMessages,
  registerPushToken,
  setMyLanguage,
} from '@campusverse/shared-communications';
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
import { DB, PEOPLE, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** The parent app: children with today's status, the feed, read and acknowledge, language. */
@Controller('parent')
@UseGuards(ActorGuard)
export class ParentController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
    @Inject(PEOPLE) private readonly people: PeopleDeps,
  ) {}

  @Get('home')
  async home(@Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const deps = { db: this.db, permissions: this.permissions };
    const children = await myChildren(this.people, actor);
    return {
      language: await myLanguage(deps, actor),
      unread: (await myMessages(deps, actor, { limit: 1 })).unread,
      children: await Promise.all(
        children.map(async (c) => ({
          ...c,
          day: await childDay(deps, actor, c.personId),
          bus: await childBus(
            this.db,
            this.permissions,
            [schoolPlacement, academicPlacement],
            actor,
            c.personId,
          ),
        })),
      ),
    };
  }

  /** "Not taking the bus today" (or undo it). */
  @Post('children/:id/bus-skip')
  @HttpCode(204)
  async skip(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await skipRide(this.db, this.permissions, [schoolPlacement, academicPlacement], actorOf(req), {
      ...SkipRideInput.parse(body),
      studentId: Id.parse(id),
    });
  }

  /** The child's timetable: today and the coming school days. */
  @Get('children/:id/timetable')
  timetable(@Param('id') id: string, @Req() req: AuthedRequest) {
    return childWeek(this.db, this.permissions, actorOf(req), Id.parse(id));
  }

  @Get('messages')
  messages(@Query('childId') childId: string | undefined, @Req() req: AuthedRequest) {
    return myMessages({ db: this.db, permissions: this.permissions }, actorOf(req), {
      aboutPersonId: childId ? Id.parse(childId) : null,
    });
  }

  @Post('messages/:id/read')
  @HttpCode(204)
  async read(@Param('id') id: string, @Req() req: AuthedRequest) {
    await markRead({ db: this.db, permissions: this.permissions }, actorOf(req), Id.parse(id));
  }

  @Post('messages/:id/acknowledge')
  @HttpCode(204)
  async ack(@Param('id') id: string, @Req() req: AuthedRequest) {
    await acknowledge({ db: this.db, permissions: this.permissions }, actorOf(req), Id.parse(id));
  }

  @Put('language')
  @HttpCode(204)
  async language(@Body() body: unknown, @Req() req: AuthedRequest) {
    await setMyLanguage(
      { db: this.db, permissions: this.permissions },
      actorOf(req),
      LanguageInput.parse(body).language,
    );
  }

  @Post('push-token')
  @HttpCode(204)
  async pushToken(@Body() body: unknown, @Req() req: AuthedRequest) {
    await registerPushToken(
      { db: this.db, permissions: this.permissions },
      actorOf(req),
      PushTokenInput.parse(body).token,
    );
  }
}
