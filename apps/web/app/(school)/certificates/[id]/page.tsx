import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { CertificateView } from './certificate-view';

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/certificates/${encodeURIComponent(id)}`);
  return <CertificateView id={id} />;
}
