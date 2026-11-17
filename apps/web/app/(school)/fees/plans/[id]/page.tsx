import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../../lib/session';
import { PlanEditor } from './plan-editor';

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/fees/plans/${encodeURIComponent(id)}`);
  return <PlanEditor planId={id === 'new' ? null : id} />;
}
