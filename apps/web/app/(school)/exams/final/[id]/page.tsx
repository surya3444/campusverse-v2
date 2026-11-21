import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../../lib/session';
import { FinalView } from './final-view';

export default async function FinalResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/exams/final/${encodeURIComponent(id)}`);
  return <FinalView id={id} />;
}
