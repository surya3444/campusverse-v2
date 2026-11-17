import {
  Id,
  LibraryCopiesInput,
  LibraryIssueInput,
  LibraryPlaceInput,
  LibraryReasonInput,
  LibraryReturnInput,
  LibrarySettingsInput,
  LibraryTitleInput,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import { academicPlacement } from '@campusverse/academics-structure';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  addCopies,
  addTitle,
  borrowerLoans,
  childLoans,
  findBorrowers,
  foundCopy,
  issueBook,
  libraryFigures,
  librarySettings,
  listTitles,
  markLost,
  overdueLoans,
  renewLoan,
  returnBook,
  suggestAccessions,
  titleCopies,
  updateLibrarySettings,
  waiveFine,
  withdrawCopy,
  type LibraryDeps,
} from '@campusverse/shared-library';
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
const Count = z.coerce.number().int().min(1).max(50);

/** The library (docs/specs/LIBRARY.md): the desk, the catalogue, overdue, borrowers, settings. */
@Controller('library')
@UseGuards(ActorGuard)
export class LibraryController {
  private readonly deps: LibraryDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions, placements: [schoolPlacement, academicPlacement] };
  }

  @Get('figures')
  figures(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return libraryFigures(this.deps, actorOf(req), Id.parse(i));
  }

  @Get('settings')
  settings(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return librarySettings(this.deps, actorOf(req), Id.parse(i));
  }

  @Put('settings')
  @HttpCode(204)
  async saveSettings(
    @Query('institutionId') i: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await updateLibrarySettings(
      this.deps,
      actorOf(req),
      Id.parse(i),
      LibrarySettingsInput.parse(body),
    );
  }

  @Get('titles')
  titles(
    @Query('institutionId') i: string,
    @Query('search') search: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return listTitles(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      search: search?.slice(0, 100),
    });
  }

  @Post('titles')
  addTitle(@Body() body: unknown, @Req() req: AuthedRequest) {
    return addTitle(this.deps, actorOf(req), LibraryTitleInput.parse(body));
  }

  @Get('titles/:id/copies')
  copies(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return titleCopies(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      titleId: Id.parse(id),
    });
  }

  @Post('titles/:id/copies')
  addCopies(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return addCopies(this.deps, actorOf(req), {
      titleId: Id.parse(id),
      ...LibraryCopiesInput.parse(body),
    });
  }

  @Get('accessions/next')
  next(
    @Query('institutionId') i: string,
    @Query('count') count: string,
    @Req() req: AuthedRequest,
  ) {
    return suggestAccessions(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      count: Count.parse(count),
    });
  }

  @Post('copies/:id/withdraw')
  @HttpCode(204)
  async withdraw(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await withdrawCopy(this.deps, actorOf(req), {
      copyId: Id.parse(id),
      ...LibraryReasonInput.parse(body),
    });
  }

  @Post('copies/:id/found')
  @HttpCode(204)
  async found(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await foundCopy(this.deps, actorOf(req), {
      copyId: Id.parse(id),
      ...LibraryPlaceInput.parse(body),
    });
  }

  @Get('borrowers')
  borrowers(
    @Query('institutionId') i: string,
    @Query('text') text: string,
    @Req() req: AuthedRequest,
  ) {
    return findBorrowers(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      text: (text ?? '').slice(0, 100),
    });
  }

  @Get('borrowers/:id')
  borrower(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return borrowerLoans(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      personId: Id.parse(id),
    });
  }

  @Post('issue')
  issue(@Body() body: unknown, @Req() req: AuthedRequest) {
    return issueBook(this.deps, actorOf(req), LibraryIssueInput.parse(body));
  }

  @Post('return')
  give(@Body() body: unknown, @Req() req: AuthedRequest) {
    return returnBook(this.deps, actorOf(req), LibraryReturnInput.parse(body));
  }

  @Get('overdue')
  overdue(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return overdueLoans(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('loans/:id/renew')
  renew(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return renewLoan(this.deps, actorOf(req), {
      loanId: Id.parse(id),
      ...LibraryPlaceInput.parse(body),
    });
  }

  @Post('loans/:id/lost')
  lost(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return markLost(this.deps, actorOf(req), {
      loanId: Id.parse(id),
      ...LibraryPlaceInput.parse(body),
    });
  }

  @Post('loans/:id/waive')
  @HttpCode(204)
  async waive(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await waiveFine(this.deps, actorOf(req), {
      loanId: Id.parse(id),
      ...LibraryReasonInput.parse(body),
    });
  }

  /** A guardian's view of one child's books. */
  @Get('children/:id')
  child(@Param('id') id: string, @Req() req: AuthedRequest) {
    return childLoans(this.deps, actorOf(req), Id.parse(id));
  }
}
