import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { RolesView } from './roles-view';

export default async function Page() {
  if (!(await hasProfile())) redirect('/login?next=/settings/roles');
  return <RolesView />;
}
