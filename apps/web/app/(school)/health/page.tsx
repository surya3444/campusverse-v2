import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { HealthView } from './health-view';

export default async function HealthPage() {
  if (!(await hasProfile())) redirect('/login?next=/health');
  return <HealthView />;
}
