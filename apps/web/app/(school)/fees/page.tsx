import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { FeesHome } from './fees-home';

export default async function FeesPage() {
  if (!(await hasProfile())) redirect('/login?next=/fees');
  return <FeesHome />;
}
