import Link from 'next/link';
import { en } from '../../messages/en';
import { AuthLayout } from '../login/auth-layout';
import { SignupForm } from './signup-form';

const t = en.signup;

export const metadata = { title: `${t.title} · ${en.app.name}` };

export default function SignupPage() {
  return (
    <AuthLayout
      title={t.title}
      lead={t.lead}
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
      <SignupForm />
    </AuthLayout>
  );
}
