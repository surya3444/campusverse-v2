// The public online application form (docs/specs/ONLINE_APPLICATIONS.md): no sign-in. The form's
// text, classes and questions come from the API on the web server; submitting goes through the
// public pass-through in app/api/v1, after a code checks the mobile number.
import type { PublicForm } from '@campusverse/school-admissions';
import { webEnv } from '@campusverse/config';
import { CircleX } from 'lucide-react';
import { headers } from 'next/headers';
import { clientIp } from '../../../lib/client-ip';
import { en } from '../../../messages/en';
import { ApplyForm } from './apply-form';

const t = en.apply;

async function load(slug: string, invite: string | null): Promise<PublicForm | null> {
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  const ip = clientIp(await headers());
  const q = invite ? `?invite=${encodeURIComponent(invite)}` : '';
  const res = await fetch(
    `${webEnv().API_URL}/api/v1/public/apply/${encodeURIComponent(slug)}${q}`,
    {
      cache: 'no-store',
      headers: ip ? { 'x-forwarded-for': ip } : {},
    },
  );
  return res.ok ? ((await res.json()) as PublicForm) : null;
}

export const metadata = { title: `${t.pageTitle} · Campusverse`, robots: { index: false } };

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { slug } = await params;
  const raw = (await searchParams).invite;
  const invite = raw && /^[A-Za-z0-9_-]{20,100}$/.test(raw) ? raw : null;
  const form = await load(slug, invite);
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-4 py-8">
      {!form ? (
        <section role="alert" className="panel mt-10 flex items-start gap-3 p-5">
          <CircleX aria-hidden className="size-5 shrink-0 text-signal-stop" />
          <span className="flex flex-col gap-1">
            <span className="text-body font-semibold text-ink">{t.unknown}</span>
            <span className="text-body text-ink-muted">{t.unknownBody}</span>
          </span>
        </section>
      ) : (
        <ApplyForm slug={slug} form={form} invite={invite} />
      )}
    </main>
  );
}
