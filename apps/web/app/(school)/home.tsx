'use client';

import { StatePanel } from '@campusverse/ui';
import { en } from '../../messages/en';
import { useInstitution } from './attendance/shared';
import { CollegeToday } from './college-today';
import { Today } from './today';

/** Today for the chosen institution: schools see the school day; colleges and universities theirs. */
export function Home() {
  const school = useInstitution();
  if (school.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  return school.profile && school.profile !== 'school' ? <CollegeToday /> : <Today />;
}
