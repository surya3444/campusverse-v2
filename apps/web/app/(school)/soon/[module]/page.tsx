import { notFound, redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { SYSTEMS } from '../../../../lib/systems';
import { SoonView } from './soon-view';

export default async function SoonPage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/soon/${module}`);
  if (!SYSTEMS.some((s) => s.apps.some((a) => a.key === module && a.status === 'planned')))
    notFound();
  return <SoonView module={module} />;
}
