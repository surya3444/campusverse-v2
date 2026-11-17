import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { sessionToken } from '../../lib/session';
import { Shell } from './shell';

export default async function PortalLayout({ children }: { children: ReactNode }) {
  if (!(await sessionToken())) redirect('/sign-in');
  return <Shell>{children}</Shell>;
}
