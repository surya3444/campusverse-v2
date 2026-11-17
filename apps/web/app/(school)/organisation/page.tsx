import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { OrganisationOverview } from './overview-view';

export default async function OrganisationPage() {
  if (!(await hasProfile())) redirect('/login?next=/organisation');
  return <OrganisationOverview />;
}
