import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { ApplicationView } from './application-view';

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/admissions/${encodeURIComponent(id)}`);
  return <ApplicationView id={id} />;
}
