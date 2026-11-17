import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { TransportView } from './transport-view';

export default async function TransportPage() {
  if (!(await hasProfile())) redirect('/login?next=/transport');
  return <TransportView />;
}
