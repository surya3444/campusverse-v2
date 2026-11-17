import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { SetupWizard } from './wizard';

/** Real data: the setup wizard talks to the API with the signed-in person's session. */
export default async function SetupPage() {
  if (!(await hasProfile())) redirect('/login?next=/setup');
  return <SetupWizard />;
}
