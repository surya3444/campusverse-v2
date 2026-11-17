import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { AskHome } from './ask-home';

export default async function AskPage() {
  if (!(await hasProfile())) redirect('/login?next=/ask');
  return <AskHome />;
}
