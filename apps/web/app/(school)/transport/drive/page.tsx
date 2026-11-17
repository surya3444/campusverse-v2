import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { DriveView } from './drive-view';

export default async function DrivePage() {
  if (!(await hasProfile())) redirect('/login?next=/transport/drive');
  return <DriveView />;
}
