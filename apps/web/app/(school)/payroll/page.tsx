import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { PayrollView } from './payroll-view';

export default async function PayrollPage() {
  if (!(await hasProfile())) redirect('/login?next=/payroll');
  return <PayrollView />;
}
