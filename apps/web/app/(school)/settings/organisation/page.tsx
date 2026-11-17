import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { OrganisationView } from './organisation-view';

export default async function Page() {
  if (!(await hasProfile())) redirect('/login?next=/settings/organisation');
  return <OrganisationView />;
}
