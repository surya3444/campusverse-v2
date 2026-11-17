import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { RegistrationView } from './registration-view';

export default async function CourseRegistrationPage() {
  if (!(await hasProfile())) redirect('/login?next=/course-registration');
  return <RegistrationView />;
}
