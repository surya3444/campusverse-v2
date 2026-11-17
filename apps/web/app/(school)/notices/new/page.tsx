import { redirect } from 'next/navigation';
import { hasProfile } from '../../../../lib/session';
import { ComposeForm } from './compose-form';

/** ?title=&body= pre-fill a draft (Verse AI drafts open here for the person to review). */
export default async function NewNoticePage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string; body?: string }>;
}) {
  if (!(await hasProfile())) redirect('/login?next=/notices/new');
  const { title = '', body = '' } = await searchParams;
  return <ComposeForm initial={{ title: title.slice(0, 120), body: body.slice(0, 2000) }} />;
}
