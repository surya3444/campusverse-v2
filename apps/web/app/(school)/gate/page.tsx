import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { GateView } from './gate-view';

export default async function GatePage() {
  if (!(await hasProfile())) redirect('/login?next=/gate');
  return <GateView />;
}
