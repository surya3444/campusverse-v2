import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { HelpdeskView } from './helpdesk-view';

export default async function HelpdeskPage() {
  if (!(await hasProfile())) redirect('/login?next=/helpdesk');
  return <HelpdeskView />;
}
