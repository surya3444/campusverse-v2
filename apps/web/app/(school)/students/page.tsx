import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { StudentsList } from './students-list';

export default async function StudentsPage() {
  if (!(await hasProfile())) redirect('/login?next=/students');
  return <StudentsList />;
}
