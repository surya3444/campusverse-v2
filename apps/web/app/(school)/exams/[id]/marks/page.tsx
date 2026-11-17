import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../../lib/session';
import { MarksView } from './marks-view';

export default async function MarksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paper?: string; section?: string }>;
}) {
  const { id } = await params;
  const { paper = '', section = '' } = await searchParams;
  if (!(await hasProfile())) redirect(`/login?next=/exams/${encodeURIComponent(id)}`);
  return <MarksView examId={id} paperId={paper} sectionId={section} />;
}
