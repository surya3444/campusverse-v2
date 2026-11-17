import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../../lib/session';
import { AccountView } from './account-view';

export default async function StudentFeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/fees/students/${encodeURIComponent(id)}`);
  return <AccountView studentId={id} />;
}
