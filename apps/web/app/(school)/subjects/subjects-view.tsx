'use client';

import type { SubjectsOverview } from '@campusverse/school-setup';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  PageHeader,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Library, Plus, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { RecordStamp } from '../common/activity';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';

const t = en.subjectsPage;
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

export function SubjectsView() {
  const school = useInstitution();
  const id = school.institutionId;
  const { can } = useMe();
  const qc = useQueryClient();
  const key = ['subjects', id];
  const view = useQuery({
    queryKey: key,
    queryFn: () => api.get<SubjectsOverview>(`/school/setup/${id}/subjects`),
    enabled: !!id,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    setError(null);
    setMessage(t.saved);
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['stamps'] });
  };
  const failed = (e: unknown) => setError(errorText(e));
  const manage = can('school.setup.manage');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Library}
        art="exams"
        area="violet"
        eyebrow={en.nav.groups.academics}
        title={t.title}
        description={t.lead}
      >
        {view.data?.yearLabel && <Pill>{t.year(view.data.yearLabel)}</Pill>}
      </PageHeader>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-signal-stop-tint px-4 py-3 text-body text-signal-stop-ink"
        >
          {error}
        </p>
      )}
      {!id || view.isPending ? (
        <SkeletonRows rows={6} label={en.states.loading.title} />
      ) : view.isError || !view.data ? (
        view.error instanceof ApiFailure && view.error.status === 403 ? (
          <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
        ) : (
          <StatePanel kind="error" title={en.states.error.title} />
        )
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 2xl:grid-cols-[340px_minmax(0,1fr)]">
          <SubjectList
            view={view.data}
            institutionId={id}
            manage={manage}
            onDone={done}
            onFail={failed}
          />
          {view.data.yearId ? (
            <Classes
              view={view.data}
              institutionId={id}
              manage={manage}
              onDone={done}
              onFail={failed}
            />
          ) : (
            <div className="panel">
              <EmptyState
                art="setup"
                title={t.noYear}
                body={t.noYearBody}
                actions={
                  <Link
                    href="/setup"
                    className="inline-flex h-10 items-center rounded-lg bg-navy-950 px-4 text-body font-medium text-white"
                  >
                    {t.openSetup}
                  </Link>
                }
              />
            </div>
          )}
        </div>
      )}
      <Announcer message={message} />
    </div>
  );
}

type Props = {
  view: SubjectsOverview;
  institutionId: string;
  manage: boolean;
  onDone: () => void;
  onFail: (e: unknown) => void;
};

function SubjectList({ view, institutionId, manage, onDone, onFail }: Props) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', kind: 'scholastic' });
  const add = useMutation({
    mutationFn: () => api.post(`/school/setup/${institutionId}/subjects`, form),
    onSuccess: () => {
      setAdding(false);
      setForm({ code: '', name: '', kind: 'scholastic' });
      onDone();
    },
  });
  const change = useMutation({
    mutationFn: (x: { subjectId: string; retired: boolean }) =>
      api.post(`/school/setup/${institutionId}/subjects/${x.subjectId}`, { retired: x.retired }),
    onSuccess: onDone,
    onError: onFail,
  });
  return (
    <Section
      title={t.list}
      flush
      actions={
        manage && !adding ? (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" />
            {t.add}
          </Button>
        ) : undefined
      }
    >
      {adding && (
        <FormModal
          title={t.add}
          submitLabel={t.create}
          cancelLabel={t.cancel}
          pending={add.isPending}
          error={add.isError ? errorText(add.error) : null}
          onClose={() => {
            add.reset();
            setAdding(false);
          }}
          onSubmit={() => add.mutate()}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.code}</span>
            <input
              required
              pattern="[A-Za-z0-9]{2,8}"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className={cx(fieldInput, 'uppercase')}
            />
            <span className="text-caption text-ink-muted">{t.codeHint}</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.name}</span>
            <input
              required
              maxLength={80}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={fieldInput}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.kind}</span>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className={fieldInput}
            >
              {Object.entries(t.kinds).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </FormModal>
      )}
      {view.subjects.length === 0 ? (
        <EmptyState compact art="exams" title={t.empty} body={t.emptyBody} />
      ) : (
        <ul className="divide-y divide-line">
          {view.subjects.map((s) => (
            <li
              key={s.subjectId}
              className={cx('flex flex-col gap-1.5 px-5 py-3', s.retired && 'bg-paper/60')}
            >
              <div className="flex items-center gap-3">
                <span className="tabular rounded-md bg-violet-tint px-2 py-0.5 text-caption font-semibold text-violet-ink">
                  {s.code}
                </span>
                <span
                  className={cx(
                    'min-w-0 flex-1 truncate text-body font-medium',
                    s.retired ? 'text-ink-muted' : 'text-ink',
                  )}
                >
                  {s.name}
                </span>
                {manage && (
                  <button
                    type="button"
                    aria-label={`${s.retired ? t.restore : t.retire}: ${s.name}`}
                    title={s.retired ? t.restore : t.retire}
                    onClick={() => change.mutate({ subjectId: s.subjectId, retired: !s.retired })}
                    className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-navy-50 hover:text-navy-950"
                  >
                    {s.retired ? (
                      <RotateCcw aria-hidden className="size-4" />
                    ) : (
                      <Archive aria-hidden className="size-4" />
                    )}
                  </button>
                )}
              </div>
              <span className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                <Pill>{t.kinds[s.kind]}</Pill>
                {s.retired ? (
                  <span>{t.retiredHint}</span>
                ) : (
                  <span>{t.classesCount(s.classes)}</span>
                )}
              </span>
              <RecordStamp id={s.subjectId} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Classes({ view, institutionId, manage, onDone, onFail }: Props) {
  const qc = useQueryClient();
  const key = ['subjects', institutionId];
  const active = view.subjects.filter((s) => !s.retired);
  type Offer = {
    classId: string;
    subjectId: string;
    offered: boolean;
    periodsPerWeek?: number | null;
  };
  // The tick shows at once; the server's answer confirms it, or puts it back.
  const offering = useMutation({
    mutationFn: (x: Offer) => api.post(`/school/setup/${institutionId}/offerings`, x),
    onMutate: (x: Offer) => {
      const before = qc.getQueryData<SubjectsOverview>(key);
      if (before)
        qc.setQueryData<SubjectsOverview>(key, {
          ...before,
          classes: before.classes.map((c) =>
            c.classId !== x.classId
              ? c
              : {
                  ...c,
                  offerings: x.offered
                    ? [
                        ...c.offerings.filter((o) => o.subjectId !== x.subjectId),
                        { subjectId: x.subjectId, periodsPerWeek: x.periodsPerWeek ?? null },
                      ]
                    : c.offerings.filter((o) => o.subjectId !== x.subjectId),
                },
          ),
        });
      return { before };
    },
    onSuccess: onDone,
    onError: (e, _x, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
      onFail(e);
    },
  });
  const teacher = useMutation({
    mutationFn: (x: { sectionId: string; subjectId: string | null; personId: string | null }) =>
      api.post(`/school/setup/${institutionId}/teachers`, x),
    onSuccess: onDone,
    onError: onFail,
  });
  const staffSelect = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void,
  ) => (
    <select
      aria-label={label}
      disabled={!manage}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={cx(fieldInput, 'h-9 min-w-40')}
    >
      <option value="">{t.nobody}</option>
      {view.staff.map((p) => (
        <option key={p.personId} value={p.personId}>
          {p.name}
        </option>
      ))}
    </select>
  );

  return (
    <section aria-labelledby="classes" className="flex flex-col gap-4">
      <h2 id="classes" className="text-lead font-semibold text-ink">
        {t.classes}
      </h2>
      {view.classes.map((c) => (
        <Section key={c.classId} title={c.name} flush>
          {c.sections.length > 0 && (
            <div className="flex flex-wrap gap-4 border-b border-line px-5 py-3">
              {c.sections.map((sec) => (
                <label
                  key={sec.sectionId}
                  className="flex items-center gap-2 text-caption text-ink-muted"
                >
                  <span className="font-medium text-ink">{sec.label}</span>
                  {staffSelect(`${t.classTeacher}, ${sec.label}`, sec.classTeacher, (personId) =>
                    teacher.mutate({ sectionId: sec.sectionId, subjectId: null, personId }),
                  )}
                </label>
              ))}
            </div>
          )}
          <div role="region" aria-label={c.name} tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-body">
              <thead>
                <tr className="border-b border-line text-left text-caption text-ink-muted">
                  <th className="px-5 py-2.5 font-medium">{t.name}</th>
                  <th className="px-3 py-2.5 font-medium">{t.offered}</th>
                  <th className="px-3 py-2.5 font-medium">{t.periods}</th>
                  {c.sections.map((sec) => (
                    <th key={sec.sectionId} className="px-3 py-2.5 font-medium">
                      {t.teacher(sec.label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map((s) => {
                  const o = c.offerings.find((x) => x.subjectId === s.subjectId);
                  return (
                    <tr key={s.subjectId} className="border-b border-line last:border-0">
                      <th scope="row" className="px-5 py-2 text-left font-medium text-ink">
                        <span className="mr-2 text-caption text-violet-ink">{s.code}</span>
                        {s.name}
                      </th>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`${t.offered}: ${s.name}, ${c.name}`}
                          disabled={!manage}
                          checked={!!o}
                          onChange={(e) =>
                            offering.mutate({
                              classId: c.classId,
                              subjectId: s.subjectId,
                              offered: e.target.checked,
                            })
                          }
                          className="size-4 accent-navy-950"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {o && (
                          <input
                            type="number"
                            min={0}
                            max={20}
                            aria-label={`${t.periods}: ${s.name}, ${c.name}`}
                            disabled={!manage}
                            defaultValue={o.periodsPerWeek ?? ''}
                            onBlur={(e) => {
                              const v = e.target.value === '' ? null : Number(e.target.value);
                              if (v !== o.periodsPerWeek)
                                offering.mutate({
                                  classId: c.classId,
                                  subjectId: s.subjectId,
                                  offered: true,
                                  periodsPerWeek: v,
                                });
                            }}
                            className={cx(fieldInput, 'h-9 w-20 tabular')}
                          />
                        )}
                      </td>
                      {c.sections.map((sec) => (
                        <td key={sec.sectionId} className="px-3 py-2">
                          {o &&
                            staffSelect(
                              `${t.teacher(sec.label)}: ${s.name}`,
                              sec.teachers.find((x) => x.subjectId === s.subjectId)?.personId ??
                                null,
                              (personId) =>
                                teacher.mutate({
                                  sectionId: sec.sectionId,
                                  subjectId: s.subjectId,
                                  personId,
                                }),
                            )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
    </section>
  );
}
