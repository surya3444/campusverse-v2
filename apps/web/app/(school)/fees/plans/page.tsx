import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { PlansView } from './plans-view';

export default async function PlansPage() {
  if (!(await hasProfile())) redirect('/login?next=/fees/plans');
  return <PlansView />;
}
