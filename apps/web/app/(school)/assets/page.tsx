import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { AssetsView } from './assets-view';

export default async function AssetsPage() {
  if (!(await hasProfile())) redirect('/login?next=/assets');
  return <AssetsView />;
}
