import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { FormsView } from './forms-view';
import { AdmissionYearGate } from '../shared';

export default async function Page() {
  if (!(await hasProfile())) redirect('/login?next=/admissions/forms');
  return (
    <AdmissionYearGate>
      <FormsView />
    </AdmissionYearGate>
  );
}
