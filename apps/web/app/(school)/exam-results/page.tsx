import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { ExamResultsView } from './exam-results-view';

export default async function ExamResultsPage() {
  if (!(await hasProfile())) redirect('/login?next=/exam-results');
  return <ExamResultsView />;
}
