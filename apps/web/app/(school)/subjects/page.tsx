import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { SubjectsView } from './subjects-view';

export default async function SubjectsPage() {
  if (!(await hasProfile())) redirect('/login?next=/subjects');
  return <SubjectsView />;
}
