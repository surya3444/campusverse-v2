import logoWhite from '@campusverse/ui/brand/logo-white.svg';
import logoColored from '@campusverse/ui/brand/logo-colored.svg';
import {
  BookCheck,
  CalendarCheck,
  IndianRupee,
  Megaphone,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { en } from '../../messages/en';
import { BrandMark } from './brand-mark';

const t = en.login;
/** In the order of en.login.modules. */
const MODULE_ICONS = [CalendarCheck, UserPlus, BookCheck, IndianRupee, Megaphone, Sparkles];

/** Sign-in and sign-up share this page: the brand side, then one task with nothing around it. */
export function AuthLayout({
  title,
  lead,
  children,
  aside,
}: {
  title: string;
  lead: string;
  children: ReactNode;
  /** Under the form, after a rule: the way to the other page. */
  aside: ReactNode;
}) {
  return (
    <main
      id="main"
      className="grid min-h-[calc(100dvh-var(--env-bar))] bg-surface lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
    >
      {/* The brand side: the mark, one line, and the kinds of campus. It stays in view while a long
          form (sign-up) scrolls. Hidden on phones. */}
      <section
        aria-label={en.app.name}
        className="midnight relative isolate hidden flex-col justify-between gap-10 overflow-hidden p-14 text-white lg:sticky lg:top-[var(--env-bar)] lg:flex lg:h-[calc(100dvh-var(--env-bar))] lg:self-start xl:p-16"
      >
        <span
          aria-hidden
          className="absolute -top-[18%] -right-[24%] -z-10 aspect-square w-[85%] rounded-full bg-navy-950/45 blur-[120px]"
        />
        <BrandMark className="absolute -top-[20%] -right-[36%] -z-10 aspect-square w-[105%]" />

        <Image src={logoWhite} alt="" width={126} height={40} className="h-9 w-auto self-start" />

        <div className="flex flex-col gap-8">
          <h2 className="max-w-[11ch] font-display text-[3.75rem] leading-[1] font-semibold tracking-[-0.045em]">
            {t.brandTitle}
          </h2>
          <p className="-mt-3 max-w-md text-lead text-white/65">{t.brandLead}</p>
          <ul className="flex max-w-xl flex-wrap gap-2">
            {t.modules.map((m, n) => {
              const Icon = MODULE_ICONS[n] ?? Sparkles;
              return (
                <li
                  key={m}
                  className="flex items-center gap-2 rounded-full bg-white/[0.07] py-1.5 pr-3.5 pl-2 text-body text-white/90 ring-1 ring-white/10 backdrop-blur"
                >
                  <span className="flex size-6 items-center justify-center rounded-full bg-white/10">
                    <Icon aria-hidden className="size-3.5 text-cyan-200" />
                  </span>
                  {m}
                </li>
              );
            })}
          </ul>
          <span aria-hidden className="h-px w-full max-w-xl bg-white/10" />
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body">
            {t.kinds.map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_var(--color-cyan-400)]"
                />
                <span className="font-medium text-white">{k}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col px-6 py-8 sm:px-12 sm:py-10">
        <Image
          src={logoColored}
          alt={en.app.name}
          priority
          width={113}
          height={36}
          className="h-8 w-auto self-start lg:invisible"
        />

        <div className="flex flex-1 items-center py-12">
          <div className="mx-auto flex w-full max-w-[400px] flex-col motion-safe:animate-rise">
            <h1 className="font-display text-[2rem] leading-tight font-semibold tracking-[-0.03em] text-ink">
              {title}
            </h1>
            <p className="mt-2 text-body text-ink-muted">{lead}</p>
            <div className="mt-8">{children}</div>
            <div className="mt-10 border-t border-line pt-6">{aside}</div>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 text-caption text-ink-muted">
          <span>{t.rights(new Date().getFullYear())}</span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck aria-hidden className="size-3.5 text-signal-go" />
            {t.secure}
          </span>
        </footer>
      </section>
    </main>
  );
}
