import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { DonationsView } from './donations-view';

export default async function DonationsPage() {
  if (!(await hasProfile())) redirect('/login?next=/donations');
  return <DonationsView />;
}
