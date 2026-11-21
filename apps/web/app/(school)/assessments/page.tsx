import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { AssessmentsView } from './assessments-view';

export default async function AssessmentsPage() {
  if (!(await hasProfile())) redirect('/login?next=/assessments');
  return <AssessmentsView />;
}
