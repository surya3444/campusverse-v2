import Link from 'next/link';
import { en } from '../../messages/en';
import { AuthLayout } from './auth-layout';
import { LoginForm } from './login-form';

/** Only same-site paths, so a crafted link can't send someone elsewhere after signing in. */
const safeNext = (next: string | undefined) =>
  next && /^\/(?!\/)[\w\-/?=&]*$/.test(next) ? next : '/ask';

const t = en.login;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  return (
    <AuthLayout
      title={t.welcome}
      lead={t.lead}
      aside={
        <>
          <p className="text-body font-medium text-ink">{t.noInvite}</p>
          <p className="mt-1 text-caption text-ink-muted">{t.noInviteBody}</p>
          <Link
            href="/signup"
            className="mt-3 inline-flex text-body font-medium text-navy-950 underline-offset-2 hover:underline"
          >
            {t.createAccount}
          </Link>
        </>
      }
    >
      <LoginForm next={next} />
    </AuthLayout>
  );
}
