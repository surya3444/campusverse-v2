import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { AttendanceView } from './attendance-view';

export default async function AttendancePage() {
  if (!(await hasProfile())) redirect('/login?next=/attendance');
  return <AttendanceView />;
}
