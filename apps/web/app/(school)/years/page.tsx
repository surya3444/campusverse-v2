import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { YearsView } from './years-view';

export default async function YearsPage() {
  if (!(await hasProfile())) redirect('/login?next=/years');
  return <YearsView />;
}
