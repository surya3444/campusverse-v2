import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { RulePacksView } from './rule-packs-view';

export default async function RulePacksPage() {
  if (!(await hasProfile())) redirect('/login?next=/rule-packs');
  return <RulePacksView />;
}
