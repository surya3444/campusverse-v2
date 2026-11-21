'use client';

// A question paper laid out for printing, with or without the answer key.
import type { PaperDetail } from '@campusverse/shared-assessments';
import { Button, StatePanel } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { ApiFailure, api } from '../../../../../lib/api';
import { en } from '../../../../../messages/en';
import { errorText, t } from '../../common';

export function PaperPrint({
  id,
  institutionId,
  withKey,
}: {
  id: string;
  institutionId: string;
  withKey: boolean;
}) {
  const p = t.paper;
  const q = useQuery({
    queryKey: ['assessment-paper', id],
    queryFn: () => api.get<PaperDetail>(`/assessments/papers/${id}?institutionId=${institutionId}`),
  });
  if (q.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (q.isError)
    return q.error instanceof ApiFailure && q.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={errorText(q.error)} />
    );
  const d = q.data;
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
      <div className="flex justify-end print:hidden">
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          {withKey ? p.printKey : p.print}
        </Button>
      </div>
      <article className="panel flex flex-col gap-5 p-6 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-col items-center gap-1 border-b border-line pb-4 text-center">
          <span className="text-body font-medium text-ink">{d.institution}</span>
          <h1 className="font-display text-title font-semibold text-ink">
            {d.title}
            {withKey ? ` · ${p.answerKey}` : ''}
          </h1>
          <span className="text-body text-ink">{d.subject}</span>
          <span className="flex flex-wrap justify-center gap-x-6 text-body text-ink tabular">
            {d.minutes && <span>{p.time(d.minutes)}</span>}
            <span>{p.maxMarks(d.blueprint.marks)}</span>
          </span>
        </header>
        {d.instructions && (
          <p className="text-body whitespace-pre-wrap text-ink">{d.instructions}</p>
        )}
        <ol className="flex flex-col gap-4">
          {d.items.map((i) => (
            <li key={i.position} className="flex break-inside-avoid flex-col gap-1.5">
              <div className="flex gap-3">
                <span className="tabular font-semibold text-ink">{i.position + 1}.</span>
                <p className="flex-1 text-body whitespace-pre-wrap text-ink">{i.prompt}</p>
                <span className="text-caption text-ink-muted tabular">[{i.marks}]</span>
              </div>
              {i.options.length > 0 && (
                <ol className="ml-8 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {i.options.map((o, k) => (
                    <li key={o} className="text-body text-ink">
                      ({String.fromCharCode(97 + k)}) {o}
                    </li>
                  ))}
                </ol>
              )}
              {withKey && i.answer && (
                <p className="ml-8 rounded-md bg-paper px-3 py-2 text-body text-ink">
                  <span className="font-semibold">{p.answerLabel}: </span>
                  {i.answer}
                  <span className="text-caption text-ink-muted">
                    {' '}
                    · {[t.bloom[i.bloom], i.coCode].filter(Boolean).join(' · ')}
                  </span>
                </p>
              )}
            </li>
          ))}
        </ol>
      </article>
    </div>
  );
}
