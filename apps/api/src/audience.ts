// Who a notice or fee plan reaches: classes and sections (school), plus transport's routes and
// fare zones and hostel residents, kept to the institution's own students. The worker builds the same.
import { schoolAudience } from '@campusverse/school-setup';
import { combineAudiences } from '@campusverse/shared-communications';
import { hostelAudience } from '@campusverse/shared-hostel';
import { transportAudience } from '@campusverse/shared-transport';

export const campusAudience = combineAudiences(schoolAudience, transportAudience, hostelAudience);
