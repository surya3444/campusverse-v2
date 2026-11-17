import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { NoticesList } from './notices-list';

export default async function NoticesPage() {
  if (!(await hasProfile())) redirect('/login?next=/notices');
  return <NoticesList />;
}
