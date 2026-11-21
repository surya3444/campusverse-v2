import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../../lib/session';
import { PaperPrint } from './paper-print';

export default async function PaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ institutionId?: string; key?: string }>;
}) {
  const { id } = await params;
  const { institutionId = '', key } = await searchParams;
  if (!(await hasProfile())) redirect(`/login?next=/assessments`);
  return <PaperPrint id={id} institutionId={institutionId} withKey={key === '1'} />;
}
