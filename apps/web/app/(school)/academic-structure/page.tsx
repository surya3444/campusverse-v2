import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { StructureView } from './structure-view';

export default async function AcademicStructurePage() {
  if (!(await hasProfile())) redirect('/login?next=/academic-structure');
  return <StructureView />;
}
