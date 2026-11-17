'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { StructurePlan } from '@campusverse/school-setup';
import { CBSE_CLASSES } from '@campusverse/rules';
import { Announcer, Button, PreviewCanvas } from '@campusverse/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { ErrorNote, formatDate, useRefreshSetup, type SetupOverview } from './shared';

const t = en.setup.structure;
const iso = /^\d{4}-\d{2}-\d{2}$/;

const Form = z
  .object({
    yearLabel: z.string().regex(/^\d{4}-\d{2}$/),
    starts: z.string().regex(iso),
    ends: z.string().regex(iso),
    classes: z.array(
      z.object({
        code: z.string(),
        runs: z.boolean(),
        sections: z.number().int().min(1).max(26),
        capacity: z.number().int().min(1).max(80),
      }),
    ),
  })
  .refine((f) => f.classes.some((c) => c.runs), { message: t.pickOne, path: ['classes'] })
  .refine((f) => f.starts < f.ends, { message: t.datesOrder, path: ['ends'] });
type FormValues = z.infer<typeof Form>;

function defaults(o: SetupOverview): FormValues {
  const starts = o.year?.starts ?? o.yearTemplate?.starts ?? new Date().toISOString().slice(0, 10);
  const y = Number(starts.slice(0, 4));
  const ends =
    o.year?.ends ??
    o.yearTemplate?.ends ??
    `${y + 1}-${starts.slice(5, 7) === '04' ? '03-31' : '04-30'}`;
  const existing = new Map(o.classes.map((c) => [c.code, c.sections.length]));
  return {
    yearLabel: o.year?.label ?? `${y}-${String((y + 1) % 100).padStart(2, '0')}`,
    starts,
    ends,
    classes: CBSE_CLASSES.map((c) => ({
      code: c.code,
      runs: existing.size > 0 ? existing.has(c.code) : /^([1-9]|10)$/.test(c.code),
      sections: existing.get(c.code) ?? 2,
      capacity: 40,
    })),
  };
}

const input =
  'h-9 rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950 aria-[invalid=true]:border-signal-stop';

export function StructureStep({
  institutionId,
  overview,
}: {
  institutionId: string;
  overview: SetupOverview;
}) {
  const refresh = useRefreshSetup(institutionId);
  const [editing, setEditing] = useState(!overview.year);
  const [plan, setPlan] = useState<StructurePlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(Form),
    defaultValues: defaults(overview),
  });
  const { register, handleSubmit, formState, watch } = form;

  const body = (v: FormValues) => ({
    board: 'CBSE' as const,
    yearLabel: v.yearLabel,
    starts: v.starts,
    ends: v.ends,
    classes: v.classes
      .filter((c) => c.runs)
      .map(({ code, sections, capacity }) => ({ code, sections, capacity })),
  });

  const preview = useMutation({
    mutationFn: (v: FormValues) =>
      api.post<{ plan: StructurePlan } | { problems: { code: string }[] }>(
        `/school/setup/${institutionId}/structure/preview`,
        body(v),
      ),
    onSuccess: (r) => ('plan' in r ? setPlan(r.plan) : setPlan(null)),
  });
  const apply = useMutation({
    mutationFn: () => api.post(`/school/setup/${institutionId}/structure`, body(form.getValues())),
    onSuccess: async () => {
      setPlan(null);
      setEditing(false);
      setMessage(t.done);
      await refresh();
    },
  });

  return (
    <div className="flex flex-col gap-6">
      {overview.year && (
        <section className="panel" aria-labelledby="structure-summary">
          <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
            <h2 id="structure-summary" className="text-body font-semibold text-ink">
              {t.applied(overview.year.label)}
            </h2>
            <span className="tabular text-caption text-ink-muted">
              {formatDate(overview.year.starts)} – {formatDate(overview.year.ends)}
            </span>
            {!editing && (
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                onClick={() => setEditing(true)}
              >
                {t.edit}
              </Button>
            )}
          </header>
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-line bg-paper text-left text-caption text-ink-muted">
                <th scope="col" className="px-5 py-2 font-medium">
                  {t.cls}
                </th>
                <th scope="col" className="px-5 py-2 font-medium">
                  {t.sections}
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  {t.students}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {overview.classes.map((c) => (
                <tr key={c.code}>
                  <td className="px-5 py-2.5 font-medium text-ink">{c.name}</td>
                  <td className="px-5 py-2.5 text-ink-muted">{c.sections.join(', ')}</td>
                  <td className="tabular px-5 py-2.5 text-right text-ink">{c.students}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {editing && (
        <form
          onSubmit={handleSubmit((v) => preview.mutate(v))}
          className="panel flex flex-col"
          noValidate
        >
          <div className="grid gap-4 border-b border-line px-5 py-5 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.yearLabel}</span>
              <input
                className={input}
                {...register('yearLabel')}
                aria-invalid={!!formState.errors.yearLabel}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.starts}</span>
              <input
                type="date"
                className={input}
                {...register('starts')}
                aria-invalid={!!formState.errors.starts}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.ends}</span>
              <input
                type="date"
                className={input}
                {...register('ends')}
                aria-invalid={!!formState.errors.ends}
              />
              {formState.errors.ends && (
                <span className="text-caption text-signal-stop-ink">
                  {formState.errors.ends.message}
                </span>
              )}
            </label>
            {overview.yearTemplate && (
              <p className="text-caption text-ink-muted sm:col-span-3">
                {t.template(overview.yearTemplate.source)}
              </p>
            )}
          </div>

          <fieldset className="px-5 py-4">
            <legend className="px-0 pt-1 pb-3 text-body font-semibold text-ink">{t.classes}</legend>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-body">
                <thead>
                  <tr className="text-left text-caption text-ink-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t.cls}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t.runs}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t.sections}
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      {t.capacity}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {CBSE_CLASSES.map((c, i) => {
                    const runs = watch(`classes.${i}.runs`);
                    return (
                      <tr key={c.code}>
                        <th scope="row" className="py-2 pr-4 text-left font-medium text-ink">
                          {c.name}
                        </th>
                        <td className="py-2 pr-4">
                          <input
                            type="checkbox"
                            aria-label={`${t.runs}: ${c.name}`}
                            className="size-4 accent-navy-950"
                            {...register(`classes.${i}.runs`)}
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            type="number"
                            min={1}
                            max={26}
                            disabled={!runs}
                            aria-label={`${t.sections}: ${c.name}`}
                            className={`${input} tabular w-20 disabled:opacity-40`}
                            {...register(`classes.${i}.sections`, { valueAsNumber: true })}
                          />
                        </td>
                        <td className="py-2">
                          <input
                            type="number"
                            min={1}
                            max={80}
                            disabled={!runs}
                            aria-label={`${t.capacity}: ${c.name}`}
                            className={`${input} tabular w-20 disabled:opacity-40`}
                            {...register(`classes.${i}.capacity`, { valueAsNumber: true })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {formState.errors.classes?.root && (
              <p className="mt-2 text-caption text-signal-stop-ink">
                {formState.errors.classes.root.message}
              </p>
            )}
          </fieldset>

          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
            <ErrorNote error={preview.error ?? apply.error} />
            {Object.keys(formState.errors).length > 0 && (
              <p className="text-caption text-signal-stop-ink">{t.invalid}</p>
            )}
            <Button type="submit" className="ml-auto" disabled={preview.isPending}>
              {t.review}
            </Button>
          </div>
        </form>
      )}

      {plan && (
        <PreviewCanvas
          open
          onOpenChange={(o) => !o && setPlan(null)}
          title={t.canvasTitle}
          actionLabel={t.action(plan.totals.sections)}
          changes={[
            t.changeYear(
              plan.year.label,
              formatDate(plan.year.starts),
              formatDate(form.getValues('ends')),
            ),
            ...plan.classes.map((c) =>
              t.changeClass(
                c.name,
                c.sections.map((s) => s.name).join(', '),
                c.subjects.map((s) => s.name).join(', '),
              ),
            ),
          ]}
          affected={[
            { label: t.affectedClasses, count: plan.totals.classes },
            { label: t.affectedSections, count: plan.totals.sections },
            { label: t.affectedSeats, count: plan.totals.seats },
          ]}
          risks={[t.risk]}
          undo={t.undo}
          busy={apply.isPending}
          onConfirm={() => apply.mutate()}
          labels={en.preview}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}
