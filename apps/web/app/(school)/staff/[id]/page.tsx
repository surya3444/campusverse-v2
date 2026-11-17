import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { StaffRecordView } from './staff-record';

export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/staff/${encodeURIComponent(id)}`);
  return <StaffRecordView personId={id} />;
}
