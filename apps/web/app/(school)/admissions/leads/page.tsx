import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { LeadsView } from './leads-view';
import { AdmissionYearGate } from '../shared';

export default async function Page() {
  if (!(await hasProfile())) redirect('/login?next=/admissions/leads');
  return (
    <AdmissionYearGate>
      <LeadsView />
    </AdmissionYearGate>
  );
}
