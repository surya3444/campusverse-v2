import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { MentoringView } from './mentoring-view';

export default async function MentoringPage() {
  if (!(await hasProfile())) redirect('/login?next=/mentoring');
  return <MentoringView />;
}
