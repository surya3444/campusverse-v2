import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { TimetableView } from './timetable-view';

export default async function TimetablePage() {
  if (!(await hasProfile())) redirect('/login?next=/timetable');
  return <TimetableView />;
}
