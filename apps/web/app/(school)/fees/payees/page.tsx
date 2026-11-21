import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { PayeesView } from './payees-view';

export default async function PayeesPage() {
  if (!(await hasProfile())) redirect('/login?next=/fees/payees');
  return <PayeesView />;
}
