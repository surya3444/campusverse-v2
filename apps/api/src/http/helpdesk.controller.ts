import {
  HelpdeskAssignInput,
  HelpdeskCategoryInput,
  HelpdeskRaiseInput,
  HelpdeskReplyInput,
  HelpdeskStateInput,
  Id,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import { academicPlacement } from '@campusverse/academics-structure';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  assignTicket,
  helpdeskCategories,
  helpdeskFigures,
  myRequests,
  raiseTicket,
  replyTicket,
  saveCategory,
  setTicketState,
  ticket,
  tickets,
  type HelpdeskDeps,
} from '@campusverse/shared-helpdesk';
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
const View = z.enum(['open', 'overdue', 'waiting', 'resolved', 'mine', 'raised']);

/** The helpdesk (docs/specs/HELPDESK.md), for staff and for parents (their own requests). */
@Controller('helpdesk')
@UseGuards(ActorGuard)
export class HelpdeskController {
  private readonly deps: HelpdeskDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions, placements: [schoolPlacement, academicPlacement] };
  }

  @Get('categories')
  categories(@Req() req: AuthedRequest) {
    return helpdeskCategories(this.deps, actorOf(req));
  }

  @Post('categories')
  addCategory(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveCategory(this.deps, actorOf(req), {
      id: null,
      ...HelpdeskCategoryInput.parse(body),
    });
  }

  @Put('categories/:id')
  editCategory(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveCategory(this.deps, actorOf(req), {
      id: Id.parse(id),
      ...HelpdeskCategoryInput.parse(body),
    });
  }

  @Get('figures')
  figures(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return helpdeskFigures(this.deps, actorOf(req), Id.parse(i));
  }

  @Get('tickets')
  tickets(
    @Query('institutionId') i: string | undefined,
    @Query('view') view: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return tickets(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      view: View.parse(view ?? 'open'),
    });
  }

  /** The person's own requests at any school (the parent app). */
  @Get('requests')
  requests(@Req() req: AuthedRequest) {
    return myRequests(this.deps, actorOf(req));
  }

  @Post('tickets')
  raise(@Body() body: unknown, @Req() req: AuthedRequest) {
    return raiseTicket(this.deps, actorOf(req), HelpdeskRaiseInput.parse(body));
  }

  @Get('tickets/:id')
  ticket(@Param('id') id: string, @Req() req: AuthedRequest) {
    return ticket(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('tickets/:id/reply')
  reply(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return replyTicket(this.deps, actorOf(req), {
      ticketId: Id.parse(id),
      ...HelpdeskReplyInput.parse(body),
    });
  }

  @Post('tickets/:id/state')
  @HttpCode(204)
  async state(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setTicketState(this.deps, actorOf(req), {
      ticketId: Id.parse(id),
      ...HelpdeskStateInput.parse(body),
    });
  }

  @Post('tickets/:id/assign')
  @HttpCode(204)
  async assign(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await assignTicket(this.deps, actorOf(req), {
      ticketId: Id.parse(id),
      ...HelpdeskAssignInput.parse(body),
    });
  }
}
