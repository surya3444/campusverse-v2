import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { StudentRecordView } from './record-view';

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/students/${encodeURIComponent(id)}`);
  return <StudentRecordView id={id} />;
}
