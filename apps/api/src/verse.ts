// Verse AI as the API wires it: each module's tools, the customer's flag and plan budget.
import { aiMonthlyTokens, flagOn } from '@campusverse/platform-control';
import type { ObjectStore } from '@campusverse/platform-documents';
import type { VerseDeps } from '@campusverse/platform-verse';
import { peopleTools } from '@campusverse/people-records';
import { admissionTools } from '@campusverse/school-admissions';
import { attendanceTools } from '@campusverse/school-attendance';
import { examTools } from '@campusverse/school-exams';
import { schoolAudience, setupTools } from '@campusverse/school-setup';
import { homeworkTools } from '@campusverse/school-homework';
import { gateTools } from '@campusverse/shared-gate';
import { expenseTools } from '@campusverse/shared-expenses';
import { hostelTools } from '@campusverse/shared-hostel';
import { libraryTools } from '@campusverse/shared-library';
import { syllabusTools } from '@campusverse/school-syllabus';
import { helpdeskTools } from '@campusverse/shared-helpdesk';
import { assetTools } from '@campusverse/shared-assets';
import { appraisalTools } from '@campusverse/people-appraisals';
import { holidaysBetween } from '@campusverse/school-attendance';
import { academicPlacement } from '@campusverse/academics-structure';
import { schoolPlacement } from '@campusverse/school-enrolment';
import { timetableTools } from '@campusverse/school-timetable';
import { campusAudience } from './audience.js';
import { staffAttendanceTools } from '@campusverse/shared-staff-attendance';
import { noticeTools } from '@campusverse/shared-communications';
import { financeTools } from '@campusverse/shared-finance';
import { transportTools } from '@campusverse/shared-transport';
import { helpSearch, type Model } from '@campusverse/verse-ai';
import type { Deps } from './http/deps.js';

export function verseDeps(
  deps: Pick<Deps, 'db' | 'permissions' | 'gateway' | 'verifyBaseUrl'>,
  model: Model | null,
  store: ObjectStore,
): VerseDeps {
  const base = { db: deps.db, permissions: deps.permissions };
  return {
    ...base,
    model,
    tools: [
      helpSearch,
      ...attendanceTools(base),
      ...financeTools({ ...base, audience: campusAudience, gateway: deps.gateway ?? null }),
      ...examTools({
        ...base,
        store,
        verifyBaseUrl: deps.verifyBaseUrl ?? 'http://localhost:3000/verify',
      }),
      ...noticeTools(),
      ...staffAttendanceTools({ ...base, holidays: holidaysBetween }),
      ...admissionTools({ ...base, audience: schoolAudience }),
      ...peopleTools({
        ...base,
        keys: null as never,
        placements: [schoolPlacement, academicPlacement],
      }),
      ...setupTools(base),
      ...transportTools(base),
      ...timetableTools(base),
      ...homeworkTools(base),
      ...gateTools({ ...base, placements: [schoolPlacement, academicPlacement] }),
      ...expenseTools(base),
      ...hostelTools({ ...base, placements: [schoolPlacement, academicPlacement] }),
      ...libraryTools({ ...base, placements: [schoolPlacement, academicPlacement] }),
      ...syllabusTools(base),
      ...helpdeskTools({ ...base, placements: [schoolPlacement, academicPlacement] }),
      ...assetTools(base),
      ...appraisalTools(base),
    ],
    switchedOn: (orgId) => flagOn(deps.db, 'verse_ai', orgId),
    monthlyTokens: (orgId) => aiMonthlyTokens(deps.db, orgId),
  };
}
