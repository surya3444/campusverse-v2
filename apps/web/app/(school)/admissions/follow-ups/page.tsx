import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { FollowUpsView } from './follow-ups-view';

export default async function Page() {
  if (!(await hasProfile())) redirect('/login?next=/admissions/follow-ups');
  return <FollowUpsView />;
}
