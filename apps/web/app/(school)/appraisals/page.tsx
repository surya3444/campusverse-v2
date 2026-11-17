import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { AppraisalsView } from './appraisals-view';

export default async function AppraisalsPage() {
  if (!(await hasProfile())) redirect('/login?next=/appraisals');
  return <AppraisalsView />;
}
