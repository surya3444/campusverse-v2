import { appEnv } from '@campusverse/config';
import type { ReactNode } from 'react';
import { hasProfile } from '../../lib/session';
import { Providers } from './providers';
import { SchoolShell } from './shell';

export default async function SchoolLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <SchoolShell signedIn={await hasProfile()} dev={appEnv() === 'development'}>
        {children}
      </SchoolShell>
    </Providers>
  );
}
