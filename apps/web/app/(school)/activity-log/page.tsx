import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { ActivityLogView } from './activity-log-view';

export default async function ActivityLogPage() {
  if (!(await hasProfile())) redirect('/login?next=/activity-log');
  return <ActivityLogView />;
}
