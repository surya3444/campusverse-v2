import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { SosView } from './sos-view';

export default async function EmergencyPage() {
  if (!(await hasProfile())) redirect('/login?next=/emergency');
  return <SosView />;
}
