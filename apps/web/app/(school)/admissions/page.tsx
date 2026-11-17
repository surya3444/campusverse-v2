import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { PipelineView } from './pipeline-view';

export default async function AdmissionsPage() {
  if (!(await hasProfile())) redirect('/login?next=/admissions');
  return <PipelineView />;
}
