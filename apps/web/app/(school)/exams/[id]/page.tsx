import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { ExamView } from './exam-view';

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/exams/${encodeURIComponent(id)}`);
  return <ExamView id={id} />;
}
