import {
  AadhaarInput,
  AbcInput,
  PenInput,
  ApaarInput,
  DocumentInput,
  GuardianLinkUpdate,
  Id,
  NameCorrection,
  ReasonInput,
  RevealInput,
  SectionChange,
  StaffExit,
  StaffUpdate,
  FieldValues,
  StudentDetailsInput,
  StudentUpdate,
  Day,
} from '@campusverse/contracts';
import {
  correctName,
  exitStaff,
  listStaff,
  listStudents,
  revealIdentifier,
  revealPan,
  setAadhaar,
  setAbcId,
  setApaar,
  setPen,
  setDocument,
  setGuardianFields,
  setGuardianLink,
  staffRecord,
  studentRecord,
  updateStaff,
  updateStudent,
  updateStudentDetails,
  whoAmI,
  type PeopleDeps,
} from '@campusverse/people-records';
import type { Actor } from '@campusverse/platform-permissions';
import { attendanceTaken } from '@campusverse/school-attendance';
import { changeSection, sectionOptions } from '@campusverse/school-enrolment';
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
import { PEOPLE, type AuthedRequest } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

@Controller()
@UseGuards(ActorGuard)
export class PeopleController {
  constructor(@Inject(PEOPLE) private readonly deps: PeopleDeps) {}

  @Get('people/me')
  me(@Req() req: AuthedRequest) {
    return whoAmI(this.deps, actorOf(req));
  }

  @Get('people/students')
  students(
    @Query('institutionId') institutionId: string,
    @Query('search') search: string | undefined,
    @Query('everyone') everyone: string | undefined,
    @Query('onDate') onDate: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return listStudents(this.deps, actorOf(req), {
      institutionId: Id.parse(institutionId),
      ...(search ? { search } : {}),
      everyone: everyone === '1',
      onDate: onDate ? Day.parse(onDate) : null,
    });
  }

  @Get('people/students/:id')
  student(@Param('id') id: string, @Req() req: AuthedRequest) {
    return studentRecord(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('people/students/:id')
  @HttpCode(204)
  async updateStudent(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = StudentUpdate.parse(body);
    await updateStudent(this.deps, actorOf(req), Id.parse(id), {
      ...(input.status ? { status: input.status } : {}),
      ...(input.gender ? { gender: input.gender } : {}),
      ...(input.custom ? { custom: input.custom } : {}),
    });
  }

  /** Register, UDISE+ and TC details (docs/specs/CONNECTED_SCHOOL.md). */
  @Post('people/students/:id/details')
  @HttpCode(204)
  async studentDetails(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await updateStudentDetails(
      this.deps,
      actorOf(req),
      Id.parse(id),
      StudentDetailsInput.parse(body),
    );
  }

  @Post('people/students/:id/guardians/:guardianId/fields')
  @HttpCode(204)
  async guardianFields(
    @Param('id') id: string,
    @Param('guardianId') guardianId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await setGuardianFields(
      this.deps,
      actorOf(req),
      Id.parse(id),
      Id.parse(guardianId),
      FieldValues.parse(body),
    );
  }

  @Post('people/students/:id/name')
  @HttpCode(204)
  async name(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await correctName(this.deps, actorOf(req), Id.parse(id), NameCorrection.parse(body));
  }

  @Post('people/students/:id/apaar')
  @HttpCode(204)
  async apaar(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setApaar(this.deps, actorOf(req), Id.parse(id), ApaarInput.parse(body));
  }

  @Post('people/students/:id/aadhaar')
  @HttpCode(204)
  async aadhaar(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setAadhaar(this.deps, actorOf(req), Id.parse(id), AadhaarInput.parse(body).aadhaar);
  }

  @Post('people/students/:id/pen')
  @HttpCode(204)
  async pen(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setPen(this.deps, actorOf(req), Id.parse(id), PenInput.parse(body).pen);
  }

  @Post('people/students/:id/abc')
  @HttpCode(204)
  async abc(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await setAbcId(this.deps, actorOf(req), Id.parse(id), AbcInput.parse(body).abc);
  }

  /** Shows an identifier once, for a stated reason. Audited as restricted data. */
  @Post('people/students/:id/reveal')
  @HttpCode(200)
  async reveal(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { kind, reason } = RevealInput.parse(body);
    return { value: await revealIdentifier(this.deps, actorOf(req), Id.parse(id), kind, reason) };
  }

  @Post('people/students/:id/documents')
  @HttpCode(204)
  async document(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const d = DocumentInput.parse(body);
    await setDocument(this.deps, actorOf(req), Id.parse(id), {
      kind: d.kind,
      requirement: d.requirement,
      status: d.status,
      fileId: d.fileId ?? null,
      note: d.note ?? null,
    });
  }

  @Post('people/guardian-links/:id')
  @HttpCode(204)
  async guardianLink(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const g = GuardianLinkUpdate.parse(body);
    await setGuardianLink(this.deps, actorOf(req), Id.parse(id), {
      ...(g.feePayer !== undefined ? { feePayer: g.feePayer } : {}),
      ...(g.canLogin !== undefined ? { canLogin: g.canLogin } : {}),
      ...(g.canPickup !== undefined ? { canPickup: g.canPickup } : {}),
      ...(g.restriction !== undefined ? { restriction: g.restriction } : {}),
    });
  }

  @Get('people/staff')
  staffList(
    @Query('institutionId') institutionId: string,
    @Query('includeLeft') includeLeft: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return listStaff(this.deps, actorOf(req), {
      institutionId: Id.parse(institutionId),
      includeLeft: includeLeft === 'true',
    });
  }

  @Get('people/staff/:id')
  staff(@Param('id') id: string, @Req() req: AuthedRequest) {
    return staffRecord(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('people/staff/:id')
  @HttpCode(204)
  async updateStaff(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const s = StaffUpdate.parse(body);
    await updateStaff(this.deps, actorOf(req), Id.parse(id), {
      ...(s.designation ? { designation: s.designation } : {}),
      ...(s.status ? { status: s.status } : {}),
      ...(s.joinedOn ? { joinedOn: s.joinedOn } : {}),
      ...(s.pan !== undefined ? { pan: s.pan } : {}),
    });
  }

  @Post('people/staff/:id/exit')
  @HttpCode(200)
  exit(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return exitStaff(this.deps, actorOf(req), Id.parse(id), StaffExit.parse(body));
  }

  @Post('people/staff/:id/reveal-pan')
  @HttpCode(200)
  async revealPan(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      value: await revealPan(this.deps, actorOf(req), Id.parse(id), ReasonInput.parse(body).reason),
    };
  }

  /** Where a student could move within their class this year, with seats and the earliest day. */
  @Get('school/enrolment/:personId/section-options')
  sectionOptions(@Param('personId') personId: string, @Req() req: AuthedRequest) {
    return sectionOptions(this.deps.db, this.deps.permissions, actorOf(req), Id.parse(personId), {
      attendanceTaken,
    });
  }

  /** Moves a student to another section of their class from a day neither register is taken. */
  @Post('school/enrolment/change-section')
  async changeSection(@Body() body: unknown, @Req() req: AuthedRequest) {
    const c = SectionChange.parse(body);
    return changeSection(
      this.deps.db,
      this.deps.permissions,
      actorOf(req),
      {
        personId: c.personId,
        sectionId: c.sectionId,
        from: c.from,
        reason: c.reason,
        ...(c.rollNumber !== undefined ? { rollNumber: c.rollNumber } : {}),
      },
      { attendanceTaken },
    );
  }
}
