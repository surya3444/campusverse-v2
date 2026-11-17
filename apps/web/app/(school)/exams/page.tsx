import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { ExamsView } from './exams-view';

export default async function ExamsPage() {
  if (!(await hasProfile())) redirect('/login?next=/exams');
  return <ExamsView />;
}
