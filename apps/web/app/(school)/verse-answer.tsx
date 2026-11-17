'use client';

import type { VerseAnswer } from '@campusverse/platform-verse';
import { FileText, Link2 } from 'lucide-react';
import Link from 'next/link';
import { ApiFailure } from '../../lib/api';
import { en } from '../../messages/en';

const t = en.verse;
export type AskState =
  | { status: 'asking'; question: string }
  | { status: 'failed'; question: string; error: unknown }
  | { status: 'answered'; question: string; data: VerseAnswer };

const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const asOf = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));

/** Verse AI's answer inside the palette: the text, then sources with dates, then any draft. */
export function VerseAnswerView({
  state,
  onNavigate,
}: {
  state: AskState;
  onNavigate: () => void;
}) {
  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      <p className="text-caption text-ink-muted">{state.question}</p>
      {state.status === 'asking' && <p className="text-body text-ink-muted">{t.asking}</p>}
      {state.status === 'failed' && (
        <p role="alert" className="text-body text-signal-stop-ink">
          {state.error === 'signed_out'
            ? t.signIn
            : typeof navigator !== 'undefined' && !navigator.onLine
              ? t.offline
              : state.error instanceof ApiFailure && state.error.status === 403
                ? t.denied
                : t.failed}
        </p>
      )}
      {state.status === 'answered' && (
        <>
          <p className="text-body whitespace-pre-line text-ink">{state.data.answer}</p>
          {state.data.drafts.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              onClick={onNavigate}
              className="flex w-fit items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-caption font-medium text-navy-950 hover:border-navy-950"
            >
              <FileText aria-hidden className="size-4" />
              {t.reviewDraft(d.title)}
            </Link>
          ))}
          {state.data.sources.length > 0 && (
            <ul aria-label={t.sources} className="flex flex-wrap gap-x-3 gap-y-1 text-caption">
              {state.data.sources.map((s) => (
                <li key={`${s.href}-${s.label}`}>
                  <Link
                    href={s.href}
                    onClick={onNavigate}
                    className="inline-flex items-center gap-1 text-navy-700 underline underline-offset-2"
                  >
                    <Link2 aria-hidden className="size-3.5" />
                    {t.source(s.label, asOf(s.asOf))}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-caption text-ink-muted">{t.disclaimer}</p>
        </>
      )}
    </div>
  );
}
