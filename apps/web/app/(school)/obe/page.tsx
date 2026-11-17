import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { ObeView } from './obe-view';

export default async function ObePage() {
  if (!(await hasProfile())) redirect('/login?next=/obe');
  return <ObeView />;
}
