import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { HostelView } from './hostel-view';

export default async function HostelPage() {
  if (!(await hasProfile())) redirect('/login?next=/hostel');
  return <HostelView />;
}
