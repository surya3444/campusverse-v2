import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { MarkView } from './mark-view';

export default async function MarkPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { sectionId } = await params;
  const { date } = await searchParams;
  if (!(await hasProfile())) redirect(`/login?next=/attendance/${encodeURIComponent(sectionId)}`);
  return (
    <MarkView sectionId={sectionId} date={date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null} />
  );
}
