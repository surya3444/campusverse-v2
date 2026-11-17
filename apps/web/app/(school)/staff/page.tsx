import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { StaffList } from './staff-list';

export default async function StaffPage() {
  if (!(await hasProfile())) redirect('/login?next=/staff');
  return <StaffList />;
}
