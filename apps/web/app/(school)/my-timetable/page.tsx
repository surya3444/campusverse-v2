import { redirect } from 'next/navigation';
import { hasProfile } from '../../../lib/session';
import { MyTimetableView } from './my-timetable-view';

export default async function MyTimetablePage() {
  if (!(await hasProfile())) redirect('/login?next=/my-timetable');
  return <MyTimetableView />;
}
