import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, hasProfile } from '../../lib/session';
import { OnboardingWizard } from './wizard';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ another?: string }>;
}) {
  // Signed in to an organisation already: only to set up another one of their own.
  if ((await searchParams).another !== '1' && (await hasProfile())) redirect('/');
  if (!(await cookies()).get(COOKIE.refresh)) redirect('/login?next=/onboarding');
  return <OnboardingWizard />;
}
