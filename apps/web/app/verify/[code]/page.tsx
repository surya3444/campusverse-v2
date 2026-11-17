// The public QR check: no sign-in. Asks the API directly from the web server and shows what the
// document is and whether it stands, never anything about the student.
import { webEnv } from '@campusverse/config';
import { CheckCircle2, CircleAlert, CircleX } from 'lucide-react';
import { en } from '../../../messages/en';

const t = en.verify;
type Verification = {
  kind: string;
  number: string;
  version: number;
  issuedAt: string;
  status: 'valid' | 'superseded' | 'cancelled';
};

async function check(code: string): Promise<Verification | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return null;
  const res = await fetch(`${webEnv().API_URL}/api/v1/public/verify/${encodeURIComponent(code)}`, {
    cache: 'no-store',
  });
  return res.ok ? ((await res.json()) as Verification) : null;
}

export const metadata = { title: 'Document check · Campusverse', robots: { index: false } };

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const v = await check(code);
  const dmy = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-4 py-10">
      <h1 className="text-title font-semibold text-ink">{t.title}</h1>
      {!v ? (
        <p role="alert" className="panel flex items-start gap-3 p-5 text-body text-ink">
          <CircleX aria-hidden className="size-5 shrink-0 text-signal-stop" />
          {t.notFound}
        </p>
      ) : (
        <section className="panel flex flex-col gap-4 p-5">
          <p className="flex items-start gap-3 text-body font-medium text-ink">
            {v.status === 'valid' ? (
              <CheckCircle2 aria-hidden className="size-5 shrink-0 text-signal-go" />
            ) : (
              <CircleAlert aria-hidden className="size-5 shrink-0 text-signal-warn" />
            )}
            {t[v.status]}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
            <dt className="text-ink-muted">{en.certificates.kind}</dt>
            <dd className="text-ink">{t.kinds[v.kind] ?? v.kind}</dd>
            <dt className="text-ink-muted">{t.number}</dt>
            <dd className="tabular text-ink">{v.number}</dd>
            <dt className="text-ink-muted">{t.version}</dt>
            <dd className="tabular text-ink">{v.version}</dd>
            <dt className="text-ink-muted">{t.issued}</dt>
            <dd className="text-ink">{dmy.format(new Date(v.issuedAt))}</dd>
          </dl>
          <p className="text-caption text-ink-muted">{t.privacy}</p>
        </section>
      )}
    </main>
  );
}
