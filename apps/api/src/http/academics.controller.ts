import {
  AdvanceTermInput,
  BatchInput,
  CurriculumCourseInput,
  BatchEnrolInput,
  EnrolFileInput,
  Id,
  ProgramInput,
  RegulationInput,
  CourseLockInput,
  HallTicketInput,
  MarksInput,
  RegisterInput,
  ReexamInput,
  ReexamMarkInput,
  ResultsDecisionInput,
  RegistrationDecisionInput,
  RegistrationWindowInput,
  SectionInput,
} from '@campusverse/contracts';
import {
  abcCreditFile,
  eligibilityBoard,
  hallTicketUrl,
  issueHallTickets,
  sendIneligibilityNotices,
  decideReexam,
  markReexam,
  reexamBoard,
  requestReexam,
  decideResults,
  examBoard,
  gradeCard,
  marksSheet,
  saveMarks,
  sendResults,
  setCourseLock,
} from '@campusverse/academics-exams';
import {
  decideRegistration,
  register,
  registrationBoard,
  saveWindow,
} from '@campusverse/academics-registration';
import type { Db } from '@campusverse/db';
import {
  addBatch,
  addProgram,
  addSection,
  advanceTerm,
  batchView,
  draftRegulation,
  enrolStudent,
  enrolFromFile,
  publishRegulation,
  regulationView,
  removeCurriculumCourse,
  setCurriculumCourse,
  structureOverview,
  type StructureDeps,
} from '@campusverse/academics-structure';
import type { Actor } from '@campusverse/platform-permissions';
import {
  Body,
  Controller,
  Delete,
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
import { DB, EXAMS, PEOPLE, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import type { PeopleDeps } from '@campusverse/people-records';
import type { ObjectStore } from '@campusverse/platform-documents';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Academics › Academic Structure (rule book §13.2): programs, regulations, batches and terms. */
@Controller('academics')
@UseGuards(ActorGuard)
export class AcademicsController {
  private readonly deps: StructureDeps & {
    keys: PeopleDeps['keys'];
    store: ObjectStore;
    verifyBaseUrl: string;
  };
  constructor(
    @Inject(DB) db: Db,
    @Inject(PERMISSIONS) permissions: Permissions,
    @Inject(PEOPLE) people: PeopleDeps,
    // Hall tickets are issued documents: the same store and verify address as school exams.
    @Inject(EXAMS) exams: { store: ObjectStore; verifyBaseUrl: string },
  ) {
    this.deps = {
      db,
      permissions,
      keys: people.keys,
      store: exams.store,
      verifyBaseUrl: exams.verifyBaseUrl,
    };
  }

  @Get('structure')
  overview(@Query('institutionId') institutionId: string, @Req() req: AuthedRequest) {
    return structureOverview(this.deps, actorOf(req), Id.parse(institutionId));
  }

  @Post('programs')
  async program(@Body() body: unknown, @Req() req: AuthedRequest) {
    return { id: await addProgram(this.deps, actorOf(req), ProgramInput.parse(body)) };
  }

  @Post('programs/:id/regulations')
  async regulation(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await draftRegulation(this.deps, actorOf(req), {
        programId: Id.parse(id),
        ...RegulationInput.parse(body),
      }),
    };
  }

  @Get('regulations/:id')
  regulationView(@Param('id') id: string, @Req() req: AuthedRequest) {
    return regulationView(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('regulations/:id/courses')
  async course(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await setCurriculumCourse(this.deps, actorOf(req), {
        regulationId: Id.parse(id),
        ...CurriculumCourseInput.parse(body),
      }),
    };
  }

  @Delete('regulations/:id/courses/:courseId')
  @HttpCode(204)
  async removeCourse(
    @Param('id') id: string,
    @Param('courseId') courseId: string,
    @Req() req: AuthedRequest,
  ) {
    await removeCurriculumCourse(this.deps, actorOf(req), {
      regulationId: Id.parse(id),
      courseId: Id.parse(courseId),
    });
  }

  @Post('regulations/:id/publish')
  @HttpCode(204)
  async publish(@Param('id') id: string, @Req() req: AuthedRequest) {
    await publishRegulation(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('programs/:id/batches')
  async batch(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await addBatch(this.deps, actorOf(req), {
        programId: Id.parse(id),
        ...BatchInput.parse(body),
      }),
    };
  }

  @Get('batches/:id')
  batchView(@Param('id') id: string, @Req() req: AuthedRequest) {
    return batchView(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('batches/:id/sections')
  async section(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await addSection(this.deps, actorOf(req), {
        batchId: Id.parse(id),
        ...SectionInput.parse(body),
      }),
    };
  }

  @Post('batches/:id/advance')
  advance(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return advanceTerm(this.deps, actorOf(req), {
      batchId: Id.parse(id),
      ...AdvanceTermInput.parse(body),
    });
  }

  @Post('batches/:id/students')
  async enrol(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      personId: await enrolStudent(this.deps, actorOf(req), {
        batchId: Id.parse(id),
        ...BatchEnrolInput.parse(body),
      }),
    };
  }

  /** A batch's students from a file: checked, or checked and enrolled (onboarding a college). */
  @Post('batches/:id/enrol-file')
  enrolFile(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return enrolFromFile(this.deps, actorOf(req), {
      batchId: Id.parse(id),
      ...EnrolFileInput.parse(body),
    });
  }

  // Course Registration (rule book §13.2) -------------------------------------------------------

  @Get('batches/:id/registration')
  registration(@Param('id') id: string, @Req() req: AuthedRequest) {
    return registrationBoard(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('batches/:id/registration/window')
  async window(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await saveWindow(this.deps, actorOf(req), {
        batchId: Id.parse(id),
        ...RegistrationWindowInput.parse(body),
      }),
    };
  }

  @Post('batches/:id/registration')
  async register(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await register(this.deps, actorOf(req), {
        batchId: Id.parse(id),
        ...RegisterInput.parse(body),
      }),
    };
  }

  @Post('registrations/:id/decision')
  @HttpCode(204)
  async decide(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await decideRegistration(this.deps, actorOf(req), {
      registrationId: Id.parse(id),
      ...RegistrationDecisionInput.parse(body),
    });
  }

  // Exams & Results for colleges (rule book §13.2) -----------------------------------------------

  @Get('batches/:id/exams')
  exams(@Param('id') id: string, @Req() req: AuthedRequest) {
    return examBoard(this.deps, actorOf(req), Id.parse(id));
  }

  @Get('batches/:id/exams/courses/:courseId')
  marks(@Param('id') id: string, @Param('courseId') courseId: string, @Req() req: AuthedRequest) {
    return marksSheet(this.deps, actorOf(req), {
      batchId: Id.parse(id),
      courseId: Id.parse(courseId),
    });
  }

  @Post('batches/:id/exams/courses/:courseId')
  async saveMarks(
    @Param('id') id: string,
    @Param('courseId') courseId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    return {
      saved: await saveMarks(this.deps, actorOf(req), {
        batchId: Id.parse(id),
        courseId: Id.parse(courseId),
        ...MarksInput.parse(body),
      }),
    };
  }

  @Post('batches/:id/exams/courses/:courseId/lock')
  @HttpCode(204)
  async lock(
    @Param('id') id: string,
    @Param('courseId') courseId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await setCourseLock(this.deps, actorOf(req), {
      batchId: Id.parse(id),
      courseId: Id.parse(courseId),
      ...CourseLockInput.parse(body),
    });
  }

  @Post('batches/:id/results')
  async sendResults(@Param('id') id: string, @Req() req: AuthedRequest) {
    return { id: await sendResults(this.deps, actorOf(req), Id.parse(id)) };
  }

  @Post('results/:id/decision')
  async decideResults(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      outcome: await decideResults(this.deps, actorOf(req), {
        resultId: Id.parse(id),
        ...ResultsDecisionInput.parse(body),
      }),
    };
  }

  @Get('batches/:id/grade-card/:studentId')
  gradeCard(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Req() req: AuthedRequest,
  ) {
    return gradeCard(this.deps, actorOf(req), {
      batchId: Id.parse(id),
      studentId: Id.parse(studentId),
    });
  }

  /** Eligibility and hall tickets for the term's end exams (rule book §13.2, §16). */
  @Get('batches/:id/eligibility')
  eligibility(@Param('id') id: string, @Req() req: AuthedRequest) {
    return eligibilityBoard(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('batches/:id/hall-tickets')
  hallTickets(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return issueHallTickets(this.deps, actorOf(req), {
      batchId: Id.parse(id),
      ...HallTicketInput.parse(body),
    });
  }

  @Get('batches/:id/hall-tickets/:studentId')
  async hallTicket(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Req() req: AuthedRequest,
  ) {
    return {
      url: await hallTicketUrl(this.deps, actorOf(req), {
        batchId: Id.parse(id),
        studentId: Id.parse(studentId),
      }),
    };
  }

  @Post('batches/:id/ineligibility-notices')
  notices(@Param('id') id: string, @Req() req: AuthedRequest) {
    return sendIneligibilityNotices(this.deps, actorOf(req), Id.parse(id));
  }

  /** Re-exams on published grades (rule book §13.2: revaluation, supplementary). */
  @Get('batches/:id/reexams')
  reexams(@Param('id') id: string, @Req() req: AuthedRequest) {
    return reexamBoard(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('batches/:id/reexams')
  async requestReexam(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      id: await requestReexam(this.deps, actorOf(req), {
        batchId: Id.parse(id),
        ...ReexamInput.parse(body),
      }),
    };
  }

  @Post('reexams/:id/mark')
  markReexam(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return markReexam(this.deps, actorOf(req), {
      reexamId: Id.parse(id),
      ...ReexamMarkInput.parse(body),
    });
  }

  @Post('reexams/:id/decision')
  async decideReexam(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return {
      outcome: await decideReexam(this.deps, actorOf(req), {
        reexamId: Id.parse(id),
        ...ResultsDecisionInput.parse(body),
      }),
    };
  }

  /** A published term's credits for ABC and NAD (rule book §15; P0 item 15). */
  @Get('batches/:id/abc')
  abc(@Param('id') id: string, @Query('term') term: string, @Req() req: AuthedRequest) {
    return abcCreditFile(this.deps, actorOf(req), {
      batchId: Id.parse(id),
      term: z.coerce.number().int().min(1).max(16).parse(term),
    });
  }
}
