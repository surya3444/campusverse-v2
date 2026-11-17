import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { NoticeView } from './notice-view';

export default async function NoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/notices/${encodeURIComponent(id)}`);
  return <NoticeView id={id} />;
}
