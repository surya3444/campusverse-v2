import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { SettingsView } from './settings-view';

export default async function SettingsPage() {
  if (!(await hasProfile())) redirect('/login?next=/settings');
  return <SettingsView />;
}
