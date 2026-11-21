import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../../lib/session';
import { StatementView } from './statement-view';

export default async function PayeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/fees/payees/${encodeURIComponent(id)}`);
  return <StatementView id={id} />;
}
