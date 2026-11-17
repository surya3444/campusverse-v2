import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { ProfileView } from './profile-view';

export default async function Page() {
  if (!(await hasProfile())) redirect('/login?next=/settings/profile');
  return <ProfileView />;
}
