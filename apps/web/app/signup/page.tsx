import Link from 'next/link';
import { API_URL } from '../../lib/session';
import { en } from '../../messages/en';
import { AuthLayout } from '../login/auth-layout';
import { SignupForm } from './signup-form';

const t = en.signup;

export const metadata = { title: `${t.title} · ${en.app.name}` };

/** Who an email invite's link is for; null when there is no link, false when it no longer works. */
async function inviteOf(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return token ? false : null;
  const res = await fetch(`${API_URL}/api/v1/auth/invite/${token}`, { cache: 'no-store' });
  if (!res.ok) return false;
  return { ...((await res.json()) as { name: string; email: string }), token };
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const invite = await inviteOf((await searchParams).invite);
  return (
    <AuthLayout
      title={invite ? t.invitedTitle : t.title}
      lead={invite ? t.invitedLead(invite.email) : invite === false ? t.linkGone : t.lead}
      aside={
        <p className="text-body text-ink-muted">
          {t.haveAccount}{' '}
          <Link
            href="/login"
            className="font-medium text-navy-950 underline-offset-2 hover:underline"
          >
            {t.signIn}
          </Link>
        </p>
      }
    >
      <SignupForm invite={invite || null} />
    </AuthLayout>
  );
}
