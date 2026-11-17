import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { AccessView } from './access-view';

export default async function Page() {
  if (!(await hasProfile())) redirect('/login?next=/settings/access');
  return <AccessView />;
}
