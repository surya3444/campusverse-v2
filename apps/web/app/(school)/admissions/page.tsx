import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { PipelineView } from './pipeline-view';
import { AdmissionYearGate } from './shared';

export default async function AdmissionsPage() {
  if (!(await hasProfile())) redirect('/login?next=/admissions');
  return (
    <AdmissionYearGate>
      <PipelineView />
    </AdmissionYearGate>
  );
}
