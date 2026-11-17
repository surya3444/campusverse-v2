import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { RegisterView } from './register-view';

export default async function CertificatesPage() {
  if (!(await hasProfile())) redirect('/login?next=/certificates');
  return <RegisterView />;
}
