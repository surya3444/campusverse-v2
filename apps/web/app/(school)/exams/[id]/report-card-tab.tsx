'use client';

// Report-card entries for one section: each student's co-scholastic grades (A, B, C) and the class
// teacher's remark. Suggested remarks are worked out on the school's own system from the
// student's marks and attendance (a child's marks never go to an AI model), then edited by a person.
import type { Area, ExamDetail, ReportCardSheet } from '@campusverse/school-exams';
import {
  Announcer,
  Button,
  FormModal,
  Section,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { useMe } from '../../common/me';
import { examError, field, t } from '../shared';

type Entry = { grades: Record<string, string>; remark: string };
const GRADES = ['A', 'B', 'C'] as const;

export function ReportCardPanel({
  examId,
  classes,
}: {
  examId: string;
  classes: ExamDetail['classes'];
}) {
  const sections = classes.flatMap((c) =>
    c.sections.map((s) => ({ ...s, label: s.label || c.name })),
  );
  const [sectionId, setSectionId] = useState(sections[0]?.sectionId ?? '');
  const [areasOpen, setAreasOpen] = useState(false);
  const { can } = useMe();
  if (sections.length === 0) return <p className="text-body text-ink-muted">{t.noStudents}</p>;
  return (
    <Section
      title={t.reportCard}
      description={t.reportCardLead}
      flush
      actions={
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-caption text-ink-muted">
            {t.section}
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              className={field}
            >
              {sections.map((s) => (
                <option key={s.sectionId} value={s.sectionId}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {can('school.exam.manage') && (
            <Button variant="secondary" onClick={() => setAreasOpen(true)} aria-haspopup="dialog">
              <Settings2 aria-hidden className="size-4" />
              {t.areas}
            </Button>
          )}
        </div>
      }
    >
      <Sheet key={sectionId} examId={examId} sectionId={sectionId} />
      {areasOpen && <AreasForm onClose={() => setAreasOpen(false)} />}
    </Section>
  );
}

function Sheet({ examId, sectionId }: { examId: string; sectionId: string }) {
  const qc = useQueryClient();
  const key = ['report-card', examId, sectionId];
  const sheet = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<ReportCardSheet>(`/school/exams/${examId}/report-card?sectionId=${sectionId}`),
  });
  const saved = useMemo(
    () =>
      new Map(
        (sheet.data?.students ?? []).map((s) => [
          s.personId,
          { grades: { ...s.grades } as Record<string, string>, remark: s.remark ?? '' },
        ]),
      ),
    [sheet.data],
  );
  const [draft, setDraft] = useState<Map<string, Entry>>(new Map());
  useEffect(() => setDraft(new Map(saved)), [saved]);
  const [notice, setNotice] = useState('');
  const changed = [...draft].filter(([id, e]) => {
    const was = saved.get(id);
    if (!was || was.remark.trim() !== e.remark.trim()) return true;
    const areas = new Set([...Object.keys(was.grades), ...Object.keys(e.grades)]);
    return [...areas].some((a) => (was.grades[a] ?? '') !== (e.grades[a] ?? ''));
  });
  const save = useMutation({
    mutationFn: () =>
      api.post(`/school/exams/${examId}/report-card`, {
        sectionId,
        entries: changed.map(([studentId, e]) => ({
          studentId,
          grades: Object.fromEntries(
            (sheet.data?.areas ?? []).map((a) => [a.id, e.grades[a.id] || null]),
          ),
          remark: e.remark.trim() || null,
        })),
      }),
    onSuccess: () => {
      setNotice(t.entriesSaved(changed.length));
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  if (sheet.isPending) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  if (sheet.isError)
    return sheet.error instanceof ApiFailure && sheet.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={examError(sheet.error)} />
    );
  const s = sheet.data;
  const edit = s.canEdit;
  const set = (id: string, patch: (e: Entry) => Entry) =>
    setDraft((d) => {
      const next = new Map(d);
      next.set(id, patch(d.get(id) ?? { grades: {}, remark: '' }));
      return next;
    });
  const empties = s.students.filter(
    (x) => x.suggestion && !(draft.get(x.personId)?.remark ?? '').trim(),
  );

  return (
    <div className="flex flex-col">
      <Announcer message={notice} />
      <div className="flex flex-col gap-1 border-b border-line px-5 py-3">
        <p className="text-caption text-ink-muted">{t.gradeScale}</p>
        {!edit && (
          <p className="text-caption font-medium text-ink">
            {s.examState === 'published' ? t.publishedEntries : t.readOnlyEntries}
          </p>
        )}
        {edit && (
          <p className="flex items-start gap-1.5 text-caption text-ink-muted">
            <Sparkles aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t.suggestionNote}
          </p>
        )}
      </div>
      {s.students.length === 0 ? (
        <p className="px-5 py-4 text-body text-ink-muted">{t.noStudents}</p>
      ) : (
        <ul className="divide-y divide-line">
          {s.students.map((x) => {
            const e = draft.get(x.personId) ?? { grades: {}, remark: '' };
            const remarkId = `remark-${x.personId}`;
            return (
              <li key={x.personId} className="flex flex-col gap-3 px-5 py-4 lg:flex-row">
                <div className="flex min-w-0 flex-col gap-2 lg:w-[22rem] lg:shrink-0">
                  <span className="font-medium text-ink">
                    {x.rollNumber !== null && (
                      <span className="mr-2 tabular-nums text-ink-muted">{x.rollNumber}</span>
                    )}
                    {x.name}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {s.areas.map((a) => (
                      <label key={a.id} className="flex flex-col gap-1 text-caption text-ink-muted">
                        <span className="truncate" title={a.name}>
                          {a.name}
                        </span>
                        <select
                          aria-label={t.gradeFor(a.name, x.name)}
                          disabled={!edit}
                          value={e.grades[a.id] ?? ''}
                          onChange={(ev) =>
                            set(x.personId, (o) => ({
                              ...o,
                              grades: { ...o.grades, [a.id]: ev.target.value },
                            }))
                          }
                          className={cx(field, 'w-full')}
                        >
                          <option value="">{t.noGrade}</option>
                          {GRADES.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label htmlFor={remarkId} className="text-caption text-ink-muted">
                    {t.remark}
                  </label>
                  <textarea
                    id={remarkId}
                    aria-label={t.remarkFor(x.name)}
                    readOnly={!edit}
                    maxLength={300}
                    rows={3}
                    value={e.remark}
                    onChange={(ev) => set(x.personId, (o) => ({ ...o, remark: ev.target.value }))}
                    className="min-h-20 rounded-md border border-line-strong bg-surface px-3 py-2 text-body text-ink outline-none focus:border-navy-950 read-only:bg-paper"
                  />
                  {edit && x.suggestion && x.suggestion !== e.remark && (
                    <div className="flex flex-col gap-1 rounded-md bg-paper px-3 py-2">
                      <p className="text-caption text-ink-muted">
                        <span className="sr-only">{t.suggestionFor(x.name)}: </span>
                        {x.suggestion}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          set(x.personId, (o) => ({ ...o, remark: x.suggestion ?? o.remark }))
                        }
                        aria-label={`${t.useSuggestion}: ${x.name}`}
                        className="w-fit text-caption font-medium text-navy-950 underline-offset-2 hover:underline"
                      >
                        {t.useSuggestion}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {edit && s.students.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <Button
            variant="secondary"
            disabled={empties.length === 0}
            onClick={() =>
              empties.forEach((x) => set(x.personId, (o) => ({ ...o, remark: x.suggestion ?? '' })))
            }
          >
            <Sparkles aria-hidden className="size-4" />
            {t.fillSuggestions}
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            {save.isError && (
              <span role="alert" className="text-caption text-signal-stop-ink">
                {examError(save.error)}
              </span>
            )}
            {changed.length > 0 && (
              <span className="text-caption text-ink-muted tabular-nums">
                {t.unsaved(changed.length)}
              </span>
            )}
            <Button disabled={changed.length === 0 || save.isPending} onClick={() => save.mutate()}>
              {t.saveEntries}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The institution's co-scholastic areas: add, rename by retiring and adding, retire, use again. */
function AreasForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const id = useInstitution().institutionId;
  const areas = useQuery({
    queryKey: ['exam-areas', id],
    queryFn: () => api.get<Area[]>(`/school/exams/institution/${id}/areas`),
    enabled: !!id,
  });
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: (a: { id?: string; name: string; retired?: boolean }) =>
      api.post(`/school/exams/institution/${id}/areas`, a),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: ['exam-areas', id] });
      void qc.invalidateQueries({ queryKey: ['report-card'] });
    },
  });
  return (
    <FormModal
      title={t.areas}
      description={t.areasLead}
      size="md"
      submitLabel={t.addArea}
      cancelLabel={en.form.close}
      pending={save.isPending}
      submitDisabled={!name.trim()}
      error={save.isError ? examError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate({ name: name.trim() })}
    >
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line sm:col-span-2">
        {(areas.data ?? []).map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-3 py-2">
            <span className={cx('flex-1 text-body', a.retired ? 'text-ink-muted' : 'text-ink')}>
              {a.name}
              {a.retired && <span className="ml-2 text-caption">({t.retired})</span>}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={save.isPending}
              onClick={() => save.mutate({ id: a.id, name: a.name, retired: !a.retired })}
            >
              {a.retired ? t.restore : t.retire}
            </Button>
          </li>
        ))}
      </ul>
      <label className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="text-caption font-medium text-ink">{t.areaName}</span>
        <input
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
        />
      </label>
    </FormModal>
  );
}
