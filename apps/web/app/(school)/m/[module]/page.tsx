import { notFound, redirect } from 'next/navigation';

/** Old placeholder links, kept working: each goes to the real screen. */
const MOVED: Record<string, string> = {
  attendance: '/attendance',
  students: '/students',
  fees: '/fees',
  notices: '/notices',
  settings: '/settings',
};

export default async function Moved({ params }: { params: Promise<{ module: string }> }) {
  const to = MOVED[(await params).module];
  if (!to) notFound();
  redirect(to);
}
