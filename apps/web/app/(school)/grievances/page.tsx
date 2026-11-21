import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { GrievancesView } from './grievances-view';

export default async function MentoringPage() {
  if (!(await hasProfile())) redirect('/login?next=/grievances');
  return <GrievancesView />;
}
