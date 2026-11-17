import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { SyllabusView } from './syllabus-view';

export default async function SyllabusPage() {
  if (!(await hasProfile())) redirect('/login?next=/syllabus');
  return <SyllabusView />;
}
