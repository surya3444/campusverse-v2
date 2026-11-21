import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { DrawsView } from './draws-view';
import { AdmissionYearGate } from '../shared';

export default async function DrawsPage() {
  if (!(await hasProfile())) redirect('/login?next=/admissions/draws');
  return (
    <AdmissionYearGate>
      <DrawsView />
    </AdmissionYearGate>
  );
}
