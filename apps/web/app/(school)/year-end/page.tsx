import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { YearEndView } from './year-end-view';

export default async function YearEndPage() {
  if (!(await hasProfile())) redirect('/login?next=/year-end');
  return <YearEndView />;
}
