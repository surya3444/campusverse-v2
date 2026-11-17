import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { ShortageView } from './shortage-view';

export default async function ShortagePage() {
  if (!(await hasProfile())) redirect('/login?next=/attendance/shortage');
  return <ShortageView />;
}
