import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { CourseAttendanceView } from './course-attendance-view';

export default async function CourseAttendancePage() {
  if (!(await hasProfile())) redirect('/login?next=/course-attendance');
  return <CourseAttendanceView />;
}
