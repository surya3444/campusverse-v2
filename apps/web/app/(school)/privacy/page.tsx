import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { PrivacyView } from './privacy-view';

export default async function PrivacyPage() {
  if (!(await hasProfile())) redirect('/login?next=/privacy');
  return <PrivacyView />;
}
