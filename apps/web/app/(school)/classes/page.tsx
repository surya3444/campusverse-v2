import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { ClassesView } from './classes-view';

export default async function ClassesPage() {
  if (!(await hasProfile())) redirect('/login?next=/classes');
  return <ClassesView />;
}
