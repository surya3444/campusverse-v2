import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { ApprovalsView } from './approvals-view';

export default async function Page() {
  if (!(await hasProfile())) redirect('/login?next=/settings/approvals');
  return <ApprovalsView />;
}
