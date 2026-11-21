import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { SurveysView } from './surveys-view';

export default async function SurveysPage() {
  if (!(await hasProfile())) redirect('/login?next=/surveys');
  return <SurveysView />;
}
