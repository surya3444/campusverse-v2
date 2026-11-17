import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { HomeworkView } from './homework-view';

export default async function HomeworkPage() {
  if (!(await hasProfile())) redirect('/login?next=/homework');
  return <HomeworkView />;
}
