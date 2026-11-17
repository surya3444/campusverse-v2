import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../../lib/session';
import { RegisterView } from './register-view';

export default async function RegisterPage({ params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params;
  if (!(await hasProfile()))
    redirect(`/login?next=/attendance/${encodeURIComponent(sectionId)}/register`);
  return <RegisterView sectionId={sectionId} />;
}
