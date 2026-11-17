import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { MyWorkView } from './my-work-view';

export default async function MyWorkPage() {
  if (!(await hasProfile())) redirect('/login?next=/my-work');
  return <MyWorkView />;
}
