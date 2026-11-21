'use client';

import type { ClassesOverview } from '@campusverse/school-setup';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CircleSlash,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  School,
  Settings2,
  Trash2,
  Unlock,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { useMe } from '../common/me';
import { field } from '../exams/shared';
import { formatDate } from '../setup/shared';

const t = en.classesPage;
const s = en.classesPage.structure;
type Year = ClassesOverview['years'][number];
type ClassRow = Year['classes'][number];
type SectionRow = ClassRow['sections'][number];
const errorText = (e: unknown) =>
  s.errors[e instanceof ApiFailure ? e.code : 'error'] ?? s.errors.error ?? '';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

type Dialog =
  | { kind: 'section'; year: Year; cls: ClassRow; section?: SectionRow }
  | { kind: 'remove'; section: SectionRow }
  | { kind: 'close'; section: SectionRow; closed: boolean }
  | { kind: 'addClass'; year: Year }
  | { kind: 'dropClass'; year: Year; cls: ClassRow };

/**
 * Every year's classes and sections: who teaches each, how many students, how many seats. In
 * Edit structure, the year's classes and sections change for that year only: anything while
 * nobody has used it, and sections with history close instead of being removed.
 */
export function ClassesView() {
  const school = useInstitution();
  const id = school.institutionId;
  const { can } = useMe();
  const qc = useQueryClient();
  const view = useQuery({
    queryKey: ['classes', id],
    queryFn: () => api.get<ClassesOverview>(`/school/setup/${id}/classes`),
    enabled: !!id,
  });
  const years = view.data?.years ?? [];
  const [chosen, setChosen] = useState('');
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const year =
    years.find((y) => y.yearId === chosen) ?? years.find((y) => y.status === 'active') ?? years[0];
  const sections = year?.classes.flatMap((c) => c.sections) ?? [];
  const students = sections.reduce((n, x) => n + x.students, 0);
  const seats = sections.filter((x) => !x.closed).reduce((n, x) => n + x.capacity, 0);
  // The student list shows where each student is today, so links go there only for the running year.
  const current = !!year && year.countedOn > year.starts && year.countedOn < year.ends;
  const failed = view.error ?? school.error;
  const cards = can('school.certificate.request');
  const canEdit = can('school.setup.manage') && !!year && year.status !== 'closed';
  const edit = editing && canEdit;
  const done = (m: string) => {
    setDialog(null);
    setMessage(m);
    void qc.invalidateQueries({ queryKey: ['classes'] });
    void qc.invalidateQueries({ queryKey: ['exam-years'] });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={School}
        area="violet"
        eyebrow={en.nav.groups.academics}
        title={t.title}
        description={t.lead}
        actions={
          <>
            {years.length > 1 && year ? (
              <label className="flex items-center gap-2 text-caption font-medium text-ink">
                {t.year}
                <select
                  value={year.yearId}
                  onChange={(e) => {
                    setChosen(e.target.value);
                    setEditing(false);
                  }}
                  className={field}
                >
                  {years.map((y) => (
                    <option key={y.yearId} value={y.yearId}>
                      {y.label} · {t.status[y.status]}
                    </option>
                  ))}
                </select>
              </label>
            ) : year ? (
              <Pill>{year.label}</Pill>
            ) : null}
            {canEdit && (
              <Button
                variant={edit ? 'primary' : 'secondary'}
                onClick={() => setEditing(!edit)}
                aria-pressed={edit}
              >
                <Settings2 aria-hidden className="size-4" />
                {edit ? s.done : s.edit}
              </Button>
            )}
          </>
        }
      />
      {failed ? (
        failed instanceof ApiFailure && failed.status === 403 ? (
          <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
        ) : typeof navigator !== 'undefined' && !navigator.onLine ? (
          <StatePanel
            kind="offline"
            title={en.states.offline.title}
            body={en.states.offline.body}
          />
        ) : (
          <StatePanel kind="error" title={en.states.error.title} body={en.states.error.body} />
        )
      ) : !id || view.isPending ? (
        <SkeletonRows rows={6} label={en.states.loading.title} />
      ) : !year ? (
        <Section>
          <EmptyState
            art="setup"
            title={t.empty}
            body={t.emptyBody}
            actions={
              <Link
                href="/setup"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-navy-950 px-4 text-body font-medium text-white hover:bg-navy-900"
              >
                {en.nav.setup}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            }
          />
        </Section>
      ) : (
        <>
          {edit && <Rules year={year} />}
          {year.status === 'closed' && can('school.setup.manage') && (
            <p className="flex items-center gap-2 rounded-xl border border-line bg-paper px-4 py-3 text-body text-ink">
              <Lock aria-hidden className="size-4 text-ink-muted" />
              {s.closedYear(year.label)}
            </p>
          )}
          <KeyFigures
            variant="strip"
            label={t.title}
            figures={[
              { label: t.figures.classes, value: String(year.classes.length) },
              { label: t.figures.sections, value: String(sections.length) },
              { label: t.figures.students, value: String(students) },
              { label: t.figures.seatsFree, value: String(Math.max(0, seats - students)) },
            ]}
          />
          <p className="text-caption text-ink-muted">{t.countedOn(formatDate(year.countedOn))}</p>
          {year.classes.length === 0 && (
            <Section>
              <EmptyState
                compact
                art="setup"
                title={s.noClasses(year.label)}
                body={s.noClassesBody}
              />
            </Section>
          )}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {year.classes.map((c) => {
              const open = c.sections.filter((x) => !x.closed);
              return (
                <Section
                  key={c.classId}
                  title={c.name}
                  description={s.classSummary(
                    c.sections.length,
                    open.reduce((n, x) => n + x.capacity, 0),
                  )}
                  actions={
                    edit ? (
                      <span className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setDialog({ kind: 'section', year, cls: c })}
                          aria-label={s.addSectionTo(c.name)}
                        >
                          <Plus aria-hidden className="size-4" />
                          {s.section}
                        </Button>
                        {c.sections.every((x) => !x.inUse) && (
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={() => setDialog({ kind: 'dropClass', year, cls: c })}
                            aria-label={s.dropClassFrom(c.name, year.label)}
                          >
                            <CircleSlash aria-hidden className="size-4" />
                          </Button>
                        )}
                      </span>
                    ) : undefined
                  }
                  flush
                >
                  <div role="region" aria-label={c.name} tabIndex={0} className="overflow-x-auto">
                    <table className="w-full text-body">
                      <caption className="sr-only">{c.name}</caption>
                      <thead>
                        <tr className="border-b border-line text-left text-caption text-ink-muted">
                          <th scope="col" className="px-5 py-2.5 font-medium">
                            {t.section}
                          </th>
                          <th scope="col" className="px-3 py-2.5 font-medium">
                            {t.classTeacher}
                          </th>
                          <th scope="col" className="px-3 py-2.5 text-right font-medium">
                            {t.students}
                          </th>
                          {(current || edit) && (
                            <th scope="col" className="px-5 py-2.5">
                              <span className="sr-only">{t.open}</span>
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/60">
                        {c.sections.map((x) => (
                          <tr key={x.sectionId} className={cx(x.closed && 'bg-paper/70')}>
                            <th scope="row" className="px-5 py-3 text-left font-medium text-ink">
                              <span className="flex items-center gap-2">
                                {x.name}
                                {x.closed && <Pill>{s.closed}</Pill>}
                              </span>
                            </th>
                            <td className="px-3 py-3 text-ink">
                              {x.classTeacher ?? (
                                <span className="text-ink-muted">{t.noClassTeacher}</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <span className="tabular text-ink">
                                {t.ofCapacity(x.students, x.capacity)}
                              </span>
                              <span
                                aria-hidden
                                className="mt-1 ml-auto block h-1 w-20 overflow-hidden rounded-full bg-navy-50"
                              >
                                <span
                                  className={cx(
                                    'block h-full rounded-full',
                                    x.students >= x.capacity ? 'bg-signal-stop' : 'bg-signal-go',
                                  )}
                                  style={{
                                    width: `${Math.min(100, (x.students / Math.max(1, x.capacity)) * 100)}%`,
                                  }}
                                />
                              </span>
                            </td>
                            {edit ? (
                              <td className="px-5 py-3">
                                <span className="flex justify-end gap-1">
                                  <IconAction
                                    label={s.editSection(x.label)}
                                    onClick={() =>
                                      setDialog({ kind: 'section', year, cls: c, section: x })
                                    }
                                  >
                                    <Pencil aria-hidden className="size-4" />
                                  </IconAction>
                                  {x.inUse ? (
                                    <IconAction
                                      label={
                                        x.closed
                                          ? s.reopenSection(x.label)
                                          : s.closeSection(x.label)
                                      }
                                      onClick={() =>
                                        setDialog({ kind: 'close', section: x, closed: !x.closed })
                                      }
                                    >
                                      {x.closed ? (
                                        <Unlock aria-hidden className="size-4" />
                                      ) : (
                                        <Lock aria-hidden className="size-4" />
                                      )}
                                    </IconAction>
                                  ) : (
                                    <IconAction
                                      label={s.removeSection(x.label)}
                                      tone="stop"
                                      onClick={() => setDialog({ kind: 'remove', section: x })}
                                    >
                                      <Trash2 aria-hidden className="size-4" />
                                    </IconAction>
                                  )}
                                </span>
                              </td>
                            ) : (
                              current && (
                                <td className="px-5 py-3 text-right whitespace-nowrap">
                                  {cards && (
                                    <a
                                      href={`/api/v1/school/certificates/id-cards?sectionId=${x.sectionId}`}
                                      target="_blank"
                                      rel="noopener"
                                      aria-label={t.idCardsFor(x.label)}
                                      className="mr-3 inline-flex items-center gap-1 font-medium text-navy-950 underline-offset-2 hover:underline"
                                    >
                                      {t.idCards}
                                    </a>
                                  )}
                                  <Link
                                    href={`/students?class=${encodeURIComponent(x.label)}`}
                                    aria-label={t.openSection(x.label)}
                                    className="inline-flex items-center gap-1 font-medium text-navy-950 underline-offset-2 hover:underline"
                                  >
                                    {t.open}
                                    <ArrowRight aria-hidden className="size-3.5" />
                                  </Link>
                                </td>
                              )
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              );
            })}
            {edit && (
              <button
                type="button"
                onClick={() => setDialog({ kind: 'addClass', year })}
                className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong text-body font-medium text-navy-950 transition-colors hover:border-navy-950 hover:bg-navy-50/50"
              >
                <Plus aria-hidden className="size-6" />
                {s.addClass(year.label)}
              </button>
            )}
          </div>
        </>
      )}
      {dialog?.kind === 'section' && (
        <SectionDialog
          year={dialog.year}
          cls={dialog.cls}
          {...(dialog.section ? { section: dialog.section } : {})}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.kind === 'remove' && (
        <Confirm
          title={s.removeTitle(dialog.section.label)}
          body={s.removeBody}
          action={s.remove}
          danger
          run={() => api.post(`/school/setup/sections/${dialog.section.sectionId}/remove`)}
          onClose={() => setDialog(null)}
          onDone={() => done(s.removed(dialog.section.label))}
        />
      )}
      {dialog?.kind === 'close' && (
        <Confirm
          title={
            dialog.closed ? s.closeTitle(dialog.section.label) : s.reopenTitle(dialog.section.label)
          }
          body={dialog.closed ? s.closeBody(dialog.section.students) : s.reopenBody}
          action={dialog.closed ? s.close : s.reopen}
          run={() =>
            api.post(`/school/setup/sections/${dialog.section.sectionId}/closed`, {
              closed: dialog.closed,
            })
          }
          onClose={() => setDialog(null)}
          onDone={() =>
            done(
              dialog.closed ? s.closedNow(dialog.section.label) : s.reopened(dialog.section.label),
            )
          }
        />
      )}
      {dialog?.kind === 'dropClass' && (
        <Confirm
          title={s.dropTitle(dialog.cls.name, dialog.year.label)}
          body={s.dropBody(dialog.cls.sections.length)}
          action={s.drop}
          danger
          run={() =>
            api.post(
              `/school/setup/years/${dialog.year.yearId}/classes/${dialog.cls.classId}/remove`,
            )
          }
          onClose={() => setDialog(null)}
          onDone={() => done(s.dropped(dialog.cls.name, dialog.year.label))}
        />
      )}
      {dialog?.kind === 'addClass' && view.data && (
        <AddClassDialog
          year={dialog.year}
          catalogue={view.data.catalogue}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}

/** What can change in this year, in words. */
function Rules({ year }: { year: Year }) {
  const planned = year.status === 'planned';
  return (
    <section
      aria-label={s.rulesTitle}
      className="flex flex-col gap-2 rounded-2xl border border-navy-950/15 bg-navy-50/50 px-5 py-4"
    >
      <p className="flex items-center gap-2 font-display text-body font-semibold text-ink">
        <Settings2 aria-hidden className="size-4 text-navy-950" />
        {planned ? s.rulesPlanned(year.label) : s.rulesRunning(year.label)}
      </p>
      <ul className="grid gap-1.5 text-body text-ink-muted sm:grid-cols-3">
        {(planned ? s.rulesPlannedList : s.rulesRunningList).map((r) => (
          <li key={r} className="flex items-start gap-2">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-navy-950" />
            {r}
          </li>
        ))}
      </ul>
    </section>
  );
}

function IconAction({
  label,
  onClick,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: 'stop';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'inline-flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted transition-colors hover:border-line-strong',
        tone === 'stop' ? 'hover:text-signal-stop-ink' : 'hover:text-navy-950',
      )}
    >
      {children}
    </button>
  );
}

function SectionDialog({
  year,
  cls,
  section,
  onClose,
  onDone,
}: {
  year: Year;
  cls: ClassRow;
  section?: SectionRow;
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const used = new Set(cls.sections.map((x) => x.name));
  const nextName = [...LETTERS].find((l) => !used.has(l)) ?? '';
  const [name, setName] = useState(section?.name ?? nextName);
  const [capacity, setCapacity] = useState(
    String(section?.capacity ?? cls.sections.at(-1)?.capacity ?? 30),
  );
  const save = useMutation({
    mutationFn: () =>
      section
        ? api.post(`/school/setup/sections/${section.sectionId}`, {
            name: name.trim().toUpperCase(),
            capacity: Number(capacity),
          })
        : api.post(`/school/setup/years/${year.yearId}/sections`, {
            classId: cls.classId,
            name: name.trim().toUpperCase(),
            capacity: Number(capacity),
          }),
    onSuccess: () =>
      onDone(
        section
          ? s.sectionSaved(`${cls.name}-${name.trim().toUpperCase()}`)
          : s.sectionAdded(`${cls.name}-${name.trim().toUpperCase()}`),
      ),
  });
  const n = Number(capacity);
  return (
    <FormModal
      title={section ? s.editSection(section.label) : s.addSectionTo(cls.name)}
      description={section ? s.editLead(year.label, section.students) : s.addLead(year.label)}
      submitLabel={section ? s.save : s.addSection}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={!/^[A-Za-z0-9]{1,4}$/.test(name.trim()) || !(n >= 1 && n <= 80)}
      error={
        save.error
          ? save.error instanceof ApiFailure && save.error.code === 'below_headcount'
            ? s.belowHeadcount((save.error.details as { students?: number } | null)?.students ?? 0)
            : errorText(save.error)
          : null
      }
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={s.sectionName} hint={s.sectionNameHint}>
        <input
          value={name}
          maxLength={4}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          className={field}
        />
      </ModalField>
      <ModalField
        label={s.capacity}
        hint={section ? s.capacityHint(section.students) : s.capacityHintNew}
      >
        <input
          type="number"
          inputMode="numeric"
          min={section ? Math.max(1, section.students) : 1}
          max={80}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          className={field}
        />
      </ModalField>
    </FormModal>
  );
}

function AddClassDialog({
  year,
  catalogue,
  onClose,
  onDone,
}: {
  year: Year;
  catalogue: ClassesOverview['catalogue'];
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const running = new Set(year.classes.map((c) => c.code));
  const choices = catalogue.filter((c) => !running.has(c.code));
  const [code, setCode] = useState(choices[0]?.code ?? '');
  const [sections, setSections] = useState('2');
  const [capacity, setCapacity] = useState('30');
  const save = useMutation({
    mutationFn: () =>
      api.post(`/school/setup/years/${year.yearId}/classes`, {
        code,
        sections: Number(sections),
        capacity: Number(capacity),
      }),
    onSuccess: () =>
      onDone(s.classAdded(catalogue.find((c) => c.code === code)?.name ?? code, year.label)),
  });
  const n = Number(sections);
  const cap = Number(capacity);
  return (
    <FormModal
      title={s.addClass(year.label)}
      description={s.addClassLead}
      submitLabel={s.addClassAction}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={!code || !(n >= 1 && n <= 26) || !(cap >= 1 && cap <= 80)}
      error={save.error ? errorText(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {choices.length === 0 ? (
        <p className="col-span-full text-body text-ink-muted">{s.allRunning}</p>
      ) : (
        <>
          <ModalField label={s.cls} wide>
            <select value={code} onChange={(e) => setCode(e.target.value)} className={field}>
              {choices.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label={s.sectionsCount} hint={s.sectionsHint(n >= 1 && n <= 26 ? n : 0)}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={26}
              value={sections}
              onChange={(e) => setSections(e.target.value)}
              className={field}
            />
          </ModalField>
          <ModalField label={s.capacity} hint={s.capacityEach}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={80}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className={field}
            />
          </ModalField>
          <p className="col-span-full flex items-start gap-2 rounded-lg bg-navy-50/60 px-3 py-2.5 text-caption text-ink">
            <RotateCcw aria-hidden className="mt-0.5 size-3.5 shrink-0 text-navy-950" />
            {s.subjectsNote}
          </p>
        </>
      )}
    </FormModal>
  );
}

function Confirm({
  title,
  body,
  action,
  danger,
  run,
  onClose,
  onDone,
}: {
  title: string;
  body: string;
  action: string;
  danger?: boolean;
  run: () => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const go = useMutation({ mutationFn: run, onSuccess: onDone });
  return (
    <FormModal
      title={title}
      submitLabel={action}
      cancelLabel={en.form.cancel}
      tone={danger ? 'danger' : 'primary'}
      pending={go.isPending}
      error={go.error ? errorText(go.error) : null}
      onClose={onClose}
      onSubmit={() => go.mutate()}
    >
      <p className="col-span-full text-body text-ink-muted">{body}</p>
    </FormModal>
  );
}
