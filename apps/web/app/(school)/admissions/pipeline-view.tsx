'use client';

import type { AdmissionForm, Pipeline } from '@campusverse/school-admissions';
import {
  Announcer,
  Avatar,
  Button,
  EmptyState,
  FormModal,
  PageHeader,
  Pill,
  Progress,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { CustomFields, useFields, type Values } from '../common/custom-fields';

const t = en.admissions;
export const admissionError = (e: unknown): string =>
  t.errors[e instanceof ApiFailure ? e.code : 'error'] ?? t.errors.error ?? '';
const field =
  'h-10 rounded-lg border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';
const OPEN = [
  'enquiry',
  'contacted',
  'applied',
  'documents_pending',
  'under_review',
  'offered',
  'waitlisted',
  'confirmed',
] as const;
const CLOSED = ['enrolled', 'lost', 'withdrawn', 'rejected'] as const;

/** The academic year starting this April (or last April before it), and the next one. */
export function yearLabels(today = new Date()): string[] {
  const y = today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const label = (n: number) => `${n}-${String((n + 1) % 100).padStart(2, '0')}`;
  return [label(y), label(y + 1)];
}

export function PipelineView() {
  const school = useInstitution();
  const id = school.institutionId;
  const years = yearLabels();
  const [year, setYear] = useState(years[0] ?? '');
  const [adding, setAdding] = useState(useSearchParams().has('new'));
  const [online, setOnline] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const key = ['admissions', id, year];
  const data = useQuery({
    queryKey: key,
    queryFn: () => api.get<Pipeline>(`/school/admissions/${id}?year=${year}`),
    enabled: !!id,
  });

  if (school.isPending || (data.isPending && !!id))
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (data.isError || school.isError) {
    return data.error instanceof ApiFailure && data.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={admissionError(data.error ?? school.error)}
        action={en.states.error.action}
        onAction={() => void data.refetch()}
      />
    );
  }
  const p = data.data;
  const apps = p?.applications ?? [];
  const openApps = apps.filter((a) => (OPEN as readonly string[]).includes(a.state));
  const closedApps = apps.filter((a) => (CLOSED as readonly string[]).includes(a.state));
  const seatClasses = (p?.classes ?? []).filter((c) => c.seats !== null || c.held > 0);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={UserPlus}
        art="admissions"
        eyebrow={en.nav.groups.people}
        area="rose"
        title={t.title}
        description={t.lead}
        actions={
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.year}</span>
              <select value={year} onChange={(e) => setYear(e.target.value)} className={field}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              onClick={() => setOnline(true)}
              aria-haspopup="dialog"
              className="h-10"
            >
              <Globe aria-hidden className="size-4" />
              {t.onlineForm}
            </Button>
            <Button onClick={() => setAdding(true)} aria-haspopup="dialog" className="h-10">
              <Plus aria-hidden className="size-4" />
              {t.newEnquiry}
            </Button>
          </>
        }
      />

      {online && id && p && (
        <OnlineForm
          institutionId={id}
          institutionName={school.institutionName ?? ''}
          year={year}
          classes={p.classes}
          onClose={() => setOnline(false)}
        />
      )}

      {adding && id && p && (
        <EnquiryForm
          institutionId={id}
          year={year}
          classes={p.classes}
          onClose={() => setAdding(false)}
          onDone={(m) => {
            setAdding(false);
            setMessage(m);
          }}
        />
      )}

      {!p || apps.length === 0 ? (
        <div className="panel">
          <EmptyState art="admissions" title={t.empty} body={t.emptyBody} />
        </div>
      ) : (
        <>
          <Funnel counts={p.counts} />

          {seatClasses.length > 0 && (
            <section aria-labelledby="seats" className="panel p-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="seats" className="text-body font-semibold text-ink">
                  {t.seatsTitle}
                </h2>
                <p className="text-caption text-ink-muted">{t.seatsLead}</p>
              </div>
              <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                {seatClasses.map((c) => {
                  const ratio = c.seats ? c.held / c.seats : 0;
                  return (
                    <li key={c.classId} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-body font-medium text-ink">{c.name}</span>
                        <span className="tabular text-caption text-ink-muted">
                          {ratio >= 1 ? t.full : t.seatsShort(c.held, c.seats)}
                        </span>
                      </div>
                      <Progress
                        value={c.held}
                        max={c.seats ?? Math.max(c.held, 1)}
                        tone={ratio >= 1 ? 'stop' : ratio >= 0.85 ? 'warn' : 'go'}
                        label={`${c.name}: ${t.seats(c.held, c.seats)}`}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section aria-labelledby="board" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="board" className="text-lead font-semibold text-ink">
                {t.open}
                <span className="ml-2 text-body font-normal text-ink-muted">
                  {t.openCount(openApps.length)}
                </span>
              </h2>
              <p className="text-caption text-ink-muted xl:hidden">{t.scrollHint}</p>
            </div>
            <div
              role="region"
              aria-label={t.open}
              tabIndex={0}
              className="-mx-4 snap-x scroll-px-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:scroll-px-0 sm:px-0"
            >
              <div className="flex gap-3">
                {OPEN.map((s) => {
                  const cards = openApps.filter((a) => a.state === s);
                  return (
                    <section
                      key={s}
                      aria-labelledby={`col-${s}`}
                      className="flex w-[264px] shrink-0 snap-start flex-col gap-2.5 rounded-2xl border border-line/70 bg-navy-50/60 p-2.5"
                    >
                      <h3
                        id={`col-${s}`}
                        className="flex items-center gap-2 px-1.5 pt-1 text-body font-semibold text-ink"
                      >
                        <span aria-hidden className={cx('size-2.5 rounded-full', STAGE_DOT[s])} />
                        <span className="flex-1 truncate">{t.states[s]}</span>
                        <span className="tabular rounded-full bg-surface px-2 py-0.5 text-caption font-medium text-ink-muted ring-1 ring-line">
                          {cards.length}
                        </span>
                      </h3>
                      {cards.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-line-strong px-3 py-6 text-center text-caption text-ink-muted">
                          {t.nobodyHere}
                        </p>
                      ) : (
                        cards.map((a) => <AppCard key={a.id} a={a} />)
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          </section>

          {closedApps.length > 0 && (
            <section aria-labelledby="closed" className="panel overflow-hidden">
              <h2
                id="closed"
                className="border-b border-line px-5 py-4 text-body font-semibold text-ink"
              >
                {t.closed}
              </h2>
              <ul className="divide-y divide-line">
                {closedApps.slice(0, 30).map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/admissions/${a.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-paper"
                    >
                      <Avatar name={a.childName} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                        {a.childName}
                      </span>
                      <span className="hidden text-caption text-ink-muted sm:inline">
                        {a.className}
                      </span>
                      <Pill tone={a.state === 'enrolled' ? 'go' : 'neutral'}>
                        {t.states[a.state]}
                      </Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <Announcer message={message} />
    </div>
  );
}

const STAGE_DOT: Record<string, string> = {
  enquiry: 'bg-sky-ink',
  contacted: 'bg-navy-950',
  applied: 'bg-violet-ink',
  documents_pending: 'bg-signal-warn',
  under_review: 'bg-amber-ink',
  offered: 'bg-teal-ink',
  waitlisted: 'bg-rose-ink',
  confirmed: 'bg-signal-go',
};

const FUNNEL: { key: string; states: string[]; bar: string }[] = [
  { key: 'new', states: ['enquiry', 'contacted'], bar: 'bg-sky-ink' },
  {
    key: 'applying',
    states: ['applied', 'documents_pending', 'under_review'],
    bar: 'bg-violet-ink',
  },
  { key: 'offered', states: ['offered', 'waitlisted'], bar: 'bg-teal-ink' },
  { key: 'confirmed', states: ['confirmed'], bar: 'bg-navy-950' },
  { key: 'enrolled', states: ['enrolled'], bar: 'bg-signal-go' },
];

/** Where this year's families are, from first call to enrolment. */
function Funnel({ counts }: { counts: Pipeline['counts'] }) {
  const n = (states: string[]) =>
    states.reduce((sum, s) => sum + ((counts as Record<string, number>)[s] ?? 0), 0);
  const total = Math.max(
    1,
    FUNNEL.reduce((sum, f) => sum + n(f.states), 0),
  );
  return (
    <section
      aria-label={t.glance}
      className="panel grid grid-cols-2 overflow-hidden sm:grid-cols-5"
    >
      {FUNNEL.map((f, i) => {
        const value = n(f.states);
        const pct = Math.round((value / total) * 100);
        return (
          <div
            key={f.key}
            className={cx(
              'flex flex-col gap-2 border-line p-5',
              i > 0 && 'sm:border-l',
              i % 2 === 1 && 'max-sm:border-l',
              i > 1 && 'max-sm:border-t',
            )}
          >
            <span className="flex items-center gap-2 text-caption font-medium text-ink-muted">
              <span aria-hidden className={cx('size-2 rounded-full', f.bar)} />
              {t.funnel[f.key]}
            </span>
            <span className="tabular text-display font-bold text-ink">{value}</span>
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-navy-50">
              <span
                className={cx('block h-full rounded-full', f.bar)}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="text-caption text-ink-muted">{t.share(pct)}</span>
          </div>
        );
      })}
    </section>
  );
}

const DAY = 86_400_000;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY);

function AppCard({ a }: { a: Pipeline['applications'][number] }) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !!a.nextFollowUp && a.nextFollowUp < today;
  return (
    <Link
      href={`/admissions/${a.id}`}
      className="group lift flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]"
    >
      <span className="flex items-center gap-2.5">
        <Avatar name={a.childName} size="sm" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body font-semibold text-ink group-hover:text-navy-950">
            {a.childName}
          </span>
          <span className="truncate text-caption text-ink-muted">
            {a.className} · {t.categories[a.category]?.split(' ')[0]}
          </span>
        </span>
      </span>
      {(a.sibling ||
        a.source === 'website' ||
        (a.offerExpiresOn && a.state === 'offered') ||
        (a.nextFollowUp && ['enquiry', 'contacted'].includes(a.state))) && (
        <span className="flex flex-wrap gap-1.5">
          {a.source === 'website' && <Pill>{t.online}</Pill>}
          {a.sibling && <Pill tone="go">{t.sibling}</Pill>}
          {a.offerExpiresOn && a.state === 'offered' && (
            <Pill tone="warn">{t.expires(a.offerExpiresOn)}</Pill>
          )}
          {a.nextFollowUp && ['enquiry', 'contacted'].includes(a.state) && (
            <Pill tone={overdue ? 'stop' : 'neutral'}>{t.followUp(a.nextFollowUp)}</Pill>
          )}
        </span>
      )}
      <span className="flex items-center justify-between gap-2 border-t border-line pt-2.5 text-caption text-ink-muted">
        <span>{t.sources[a.source] ?? a.source}</span>
        <span>{t.updated(daysSince(a.updatedAt))}</span>
      </span>
    </Link>
  );
}

function EnquiryForm({
  institutionId,
  year,
  classes,
  onClose,
  onDone,
}: {
  institutionId: string;
  year: string;
  classes: Pipeline['classes'];
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    classId: classes[0]?.classId ?? '',
    category: 'general',
    source: 'walk_in',
    childName: '',
    dateOfBirth: '',
    guardianName: '',
    guardianPhone: '',
    guardianRelationship: 'mother',
    nextFollowUp: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const fields = useFields('admission');
  const [custom, setCustom] = useState<Values>({});
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string; siblings: { studentName: string }[] }>(
        `/school/admissions/${institutionId}/enquiries`,
        {
          ...f,
          yearLabel: year,
          guardianPhone: `+91${f.guardianPhone.replace(/\D/g, '').slice(-10)}`,
          dateOfBirth: f.dateOfBirth || null,
          nextFollowUp: f.nextFollowUp || null,
          ...(Object.keys(custom).length ? { custom } : {}),
        },
      ),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['admissions'] });
      onDone(
        r.siblings.length
          ? t.siblingFound(r.siblings.map((s) => s.studentName).join(', '))
          : t.saved,
      );
    },
  });
  return (
    <FormModal
      title={t.newEnquiry}
      description={year}
      size="xl"
      submitLabel={t.save}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      error={save.isError ? admissionError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.childName}</span>
        <input required value={f.childName} onChange={set('childName')} className={field} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.dateOfBirth}</span>
        <input type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} className={field} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.className}</span>
        <select value={f.classId} onChange={set('classId')} className={field}>
          {classes.map((c) => (
            <option key={c.classId} value={c.classId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.guardianName}</span>
        <input required value={f.guardianName} onChange={set('guardianName')} className={field} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.guardianPhone}</span>
        <input
          required
          inputMode="tel"
          value={f.guardianPhone}
          onChange={set('guardianPhone')}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.relationship}</span>
        <select
          value={f.guardianRelationship}
          onChange={set('guardianRelationship')}
          className={field}
        >
          {Object.entries(t.relationships).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.source}</span>
        <select value={f.source} onChange={set('source')} className={field}>
          {Object.entries(t.sources).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.category}</span>
        <select value={f.category} onChange={set('category')} className={field}>
          {Object.entries(t.categories).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.nextFollowUp}</span>
        <input
          type="date"
          value={f.nextFollowUp}
          onChange={set('nextFollowUp')}
          className={field}
        />
      </label>
      {fields.data && fields.data.length > 0 && (
        <div className="flex flex-col gap-4 border-t border-line pt-5 sm:col-span-2">
          <p className="text-body font-semibold text-ink">{en.customFields.title}</p>
          <CustomFields
            fields={fields.data}
            values={custom}
            onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))}
            problems={
              save.error instanceof ApiFailure && save.error.code === 'values'
                ? ((save.error.details as { problems?: Record<string, string> } | null)?.problems ??
                  {})
                : {}
            }
            idPrefix="enquiry"
          />
        </div>
      )}
    </FormModal>
  );
}

/** The school's online application form for a year: its link, then its settings. */
function OnlineForm({
  institutionId,
  institutionName,
  year,
  classes,
  onClose,
}: {
  institutionId: string;
  institutionName: string;
  year: string;
  classes: Pipeline['classes'];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const forms = useQuery({
    queryKey: ['admission-forms', institutionId],
    queryFn: () =>
      api.get<AdmissionForm[]>(`/school/admissions/forms?institutionId=${institutionId}`),
  });
  const existing = forms.data?.find((f) => f.yearLabel === year);
  if (forms.isPending) return null;
  return (
    <OnlineFormFields
      key={existing?.id ?? 'new'}
      institutionId={institutionId}
      year={year}
      classes={classes}
      existing={existing}
      defaultTitle={institutionName}
      onClose={onClose}
      onSaved={() => void qc.invalidateQueries({ queryKey: ['admission-forms'] })}
    />
  );
}

function OnlineFormFields({
  institutionId,
  year,
  classes,
  existing,
  defaultTitle,
  onClose,
  onSaved,
}: {
  institutionId: string;
  year: string;
  classes: Pipeline['classes'];
  existing: AdmissionForm | undefined;
  defaultTitle: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? defaultTitle);
  const [intro, setIntro] = useState(existing?.intro ?? '');
  const [classIds, setClassIds] = useState<string[]>(
    existing?.classIds ?? classes.map((c) => c.classId),
  );
  const [open, setOpen] = useState(existing?.open ?? true);
  const [closesOn, setClosesOn] = useState(existing?.closesOn ?? '');
  const [copied, setCopied] = useState(false);
  const link =
    existing && typeof window !== 'undefined'
      ? `${window.location.origin}/apply/${existing.slug}`
      : null;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        institutionId,
        yearLabel: year,
        title,
        intro,
        classIds,
        open,
        closesOn: closesOn || null,
      };
      return existing
        ? api.put(`/school/admissions/forms/${existing.id}`, body)
        : api.post('/school/admissions/forms', body);
    },
    onSuccess: onSaved,
  });
  return (
    <FormModal
      title={t.onlineTitle(year)}
      description={existing ? t.onlineCount(existing.applications) : t.onlineLead}
      submitLabel={existing ? t.onlineSave : t.onlineSetUp}
      cancelLabel={t.onlineCancel}
      pending={save.isPending}
      submitDisabled={!title.trim() || classIds.length === 0}
      error={save.error ? admissionError(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {link ? (
        <div className="col-span-full flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-caption font-medium text-ink">
            {t.onlineLink}
            <Pill tone={existing?.open ? 'go' : 'neutral'}>
              {existing?.open ? t.onlineIsOpen : t.onlineIsClosed}
            </Pill>
          </span>
          <span className="flex flex-wrap gap-2">
            <input
              readOnly
              aria-label={t.onlineLink}
              value={link}
              className={cx(field, 'min-w-0 flex-1')}
              onFocus={(e) => e.target.select()}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                void navigator.clipboard?.writeText(link).then(
                  () => setCopied(true),
                  () => undefined,
                )
              }
            >
              {t.onlineCopy}
            </Button>
          </span>
          <span aria-live="polite" className="text-caption text-ink-muted">
            {copied ? t.onlineCopied : ''}
          </span>
        </div>
      ) : (
        <p className="col-span-full text-body text-ink-muted">{t.onlineNone(year)}</p>
      )}
      <label className="col-span-full flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.onlineFormTitle}</span>
        <input
          className={field}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <span className="text-caption text-ink-muted">{t.onlineFormTitleHint}</span>
      </label>
      <label className="col-span-full flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.onlineIntro}</span>
        <textarea
          className={cx(field, 'h-auto py-2')}
          rows={3}
          maxLength={600}
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
        />
        <span className="text-caption text-ink-muted">{t.onlineIntroHint}</span>
      </label>
      <fieldset className="col-span-full flex flex-col gap-2">
        <legend className="mb-1 text-caption font-medium text-ink">{t.onlineClasses}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {classes.map((c) => (
            <label key={c.classId} className="flex items-center gap-2 text-body text-ink">
              <input
                type="checkbox"
                checked={classIds.includes(c.classId)}
                onChange={(e) =>
                  setClassIds((cur) =>
                    e.target.checked ? [...cur, c.classId] : cur.filter((x) => x !== c.classId),
                  )
                }
              />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-body text-ink">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
        {t.onlineOpen}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.onlineClosesOn}</span>
        <input
          type="date"
          className={field}
          value={closesOn}
          onChange={(e) => setClosesOn(e.target.value)}
        />
        <span className="text-caption text-ink-muted">{t.onlineClosesOnHint}</span>
      </label>
    </FormModal>
  );
}
