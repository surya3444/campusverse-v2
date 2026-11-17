import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { ExpensesView } from './expenses-view';

export default async function ExpensesPage() {
  if (!(await hasProfile())) redirect('/login?next=/expenses');
  return <ExpensesView />;
}
