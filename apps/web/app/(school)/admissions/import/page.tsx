import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { ImportView } from './import-view';
import { AdmissionYearGate } from '../shared';

export default async function Page() {
  if (!(await hasProfile())) redirect('/login?next=/admissions/import');
  return (
    <AdmissionYearGate>
      <ImportView />
    </AdmissionYearGate>
  );
}
