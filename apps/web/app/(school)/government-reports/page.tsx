import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { ReturnsView } from './returns-view';

export default async function GovernmentReportsPage() {
  if (!(await hasProfile())) redirect('/login?next=/government-reports');
  return <ReturnsView />;
}
