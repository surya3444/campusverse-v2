import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { ApplicationsView } from './applications-view';
import { AdmissionYearGate } from '../shared';

export default async function Page() {
  if (!(await hasProfile())) redirect('/login?next=/admissions/applications');
  return (
    <AdmissionYearGate>
      <ApplicationsView />
    </AdmissionYearGate>
  );
}
