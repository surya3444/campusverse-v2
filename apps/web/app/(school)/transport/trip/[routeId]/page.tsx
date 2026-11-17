import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../../lib/session';
import { TripView } from './trip-view';

export default async function TripPage({ params }: { params: Promise<{ routeId: string }> }) {
  const { routeId } = await params;
  if (!(await hasProfile())) redirect(`/login?next=/transport/trip/${encodeURIComponent(routeId)}`);
  return <TripView routeId={routeId} />;
}
