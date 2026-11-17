import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, hasProfile } from '../../lib/session';
import { OnboardingWizard } from './wizard';

export default async function OnboardingPage() {
  if (await hasProfile()) redirect('/');
  if (!(await cookies()).get(COOKIE.refresh)) redirect('/login?next=/onboarding');
  return <OnboardingWizard />;
}
