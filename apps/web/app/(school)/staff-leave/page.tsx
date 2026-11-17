import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { StaffLeaveView } from './staff-leave-view';

export default async function StaffLeavePage() {
  if (!(await hasProfile())) redirect('/login?next=/staff-leave');
  return <StaffLeaveView />;
}
