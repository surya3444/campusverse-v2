import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { AppsView } from './apps-view';

export default async function AppsPage() {
  if (!(await hasProfile())) redirect('/login?next=/apps');
  return <AppsView />;
}
