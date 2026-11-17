import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { LibraryView } from './library-view';

export default async function LibraryPage() {
  if (!(await hasProfile())) redirect('/login?next=/library');
  return <LibraryView />;
}
