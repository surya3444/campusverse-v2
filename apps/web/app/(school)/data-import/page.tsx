import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { DataImportView } from './data-import-view';

export default async function DataImportPage() {
  if (!(await hasProfile())) redirect('/login?next=/data-import');
  return <DataImportView />;
}
