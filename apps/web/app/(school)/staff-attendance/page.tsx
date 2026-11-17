import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { StaffAttendanceView } from './staff-attendance-view';

export default async function StaffAttendancePage() {
  if (!(await hasProfile())) redirect('/login?next=/staff-attendance');
  return <StaffAttendanceView />;
}
