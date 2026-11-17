'use client';

// Homework and the class diary (docs/specs/HOMEWORK.md): the person's classes, one class's
// homework and diary, and modals to set homework (with photos or PDFs) and write in the diary.
import type { DiaryEntry, DueWarning, Homework, MyClass } from '@campusverse/school-homework';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  PageHeader,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, NotebookPen, Paperclip, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';

const t = en.homework;
type Classes = { today: string; nextSchoolDay: string; manager: boolean; classes: MyClass[] };
type SectionView = { section: string; homework: Homework[]; diary: DiaryEntry[] };
type Attachment = { fileId: string; fileName: string };

const dayText = (d: string) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';
const warningText = (w: DueWarning) =>
  !w ? t.saved : w.kind === 'sunday' ? t.warnSunday : t.warnHoliday(w.name);

function QueryState({ q }: { q: { isPending: boolean; isError: boolean; error: unknown } }) {
  if (q.isPending) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  if (q.error instanceof ApiFailure && q.error.status === 403)
    return <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />;
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return (
      <StatePanel kind="offline" title={en.states.offline.title} body={en.states.offline.body} />
    );
  return <StatePanel kind="error" title={en.states.error.title} />;
}

export function HomeworkView() {
  const school = useInstitution();
  const qc = useQueryClient();
  const id = school.institutionId;
  const [chosen, setChosen] = useState<string | null>(null);
  const [modal, setModal] = useState<'set' | 'diary' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const classes = useQuery({
    queryKey: ['homework-classes', id],
    queryFn: () => api.get<Classes>(`/school/homework/classes?institutionId=${id}`),
    enabled: !!id,
  });
  const list = classes.data?.classes ?? [];
  const current = list.find((c) => c.sectionId === chosen) ?? list[0];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['homework-classes'] });
    void qc.invalidateQueries({ queryKey: ['homework-section'] });
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={NotebookPen}
        art="exams"
        area="violet"
        eyebrow={en.nav.groups.academics}
        title={t.title}
        description={t.lead}
        actions={
          list.length > 0 ? (
            <span className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setModal('diary')}>
                {t.write}
              </Button>
              <Button onClick={() => setModal('set')}>
                <Plus aria-hidden className="size-4" />
                {t.set}
              </Button>
            </span>
          ) : null
        }
      />
      {notice && (
        <p role="status" className="panel px-5 py-3 text-body text-ink">
          {notice}
        </p>
      )}
      {!id || !classes.data ? (
        <QueryState q={id ? classes : { isPending: true, isError: false, error: null }} />
      ) : list.length === 0 ? (
        <EmptyState art="exams" title={t.noClasses} body={t.noClassesBody} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Section title={classes.data.manager ? t.allClasses : t.myClasses} flush>
            <ul className="divide-y divide-line">
              {list.map((c) => (
                <li key={c.sectionId}>
                  <button
                    type="button"
                    aria-current={c.sectionId === current?.sectionId ? 'true' : undefined}
                    onClick={() => setChosen(c.sectionId)}
                    className={cx(
                      'flex w-full flex-col items-start gap-0.5 px-5 py-3 text-left hover:bg-paper',
                      c.sectionId === current?.sectionId && 'bg-navy-50',
                    )}
                  >
                    <span className="text-body font-medium text-ink">
                      {c.label}
                      {c.classTeacher ? ` · ${t.classTeacher}` : ''}
                    </span>
                    <span className="text-caption text-ink-muted">
                      {t.openCount(c.homework)} · {t.diaryCount(c.diaryToday)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
          {current && <SectionPanel key={current.sectionId} cls={current} onChanged={refresh} />}
        </div>
      )}
      {modal === 'set' && classes.data && current && (
        <HomeworkForm
          institutionId={id ?? ''}
          classes={list}
          first={current}
          defaultDue={classes.data.nextSchoolDay}
          today={classes.data.today}
          onClose={() => setModal(null)}
          onDone={(w) => {
            setModal(null);
            setNotice(warningText(w));
            refresh();
          }}
        />
      )}
      {modal === 'diary' && classes.data && current && (
        <DiaryForm
          classes={list}
          first={current}
          today={classes.data.today}
          manager={classes.data.manager}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SectionPanel({ cls, onChanged }: { cls: MyClass; onChanged: () => void }) {
  const [editing, setEditing] = useState<Homework | null>(null);
  const [withdrawing, setWithdrawing] = useState<Homework | null>(null);
  const [editingEntry, setEditingEntry] = useState<DiaryEntry | null>(null);
  const view = useQuery({
    queryKey: ['homework-section', cls.sectionId],
    queryFn: () => api.get<SectionView>(`/school/homework/sections/${cls.sectionId}`),
  });
  if (!view.data) return <QueryState q={view} />;
  const days = [...new Set(view.data.diary.map((d) => d.onDate))];
  return (
    <div className="flex flex-col gap-6">
      <Section title={t.homeworkTitle(view.data.section)} flush>
        {view.data.homework.length === 0 ? (
          <EmptyState compact art="exams" title={t.noHomework} />
        ) : (
          <ul className="divide-y divide-line">
            {view.data.homework.map((h) => (
              <li key={h.id} className="flex flex-col gap-1.5 px-5 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-body font-medium text-ink">
                    {h.subject} · {h.title}
                  </span>
                  {h.state === 'withdrawn' ? (
                    <Pill>{t.withdrawn}</Pill>
                  ) : (
                    <Pill tone="warn">{t.dueOn(dayText(h.dueOn))}</Pill>
                  )}
                  {h.editedAt && h.state === 'open' && (
                    <span className="text-caption text-ink-muted">{t.edited}</span>
                  )}
                  {h.mine && h.state === 'open' && (
                    <span className="ml-auto flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(h)}>
                        {t.edit}
                        <span className="sr-only"> {h.title}</span>
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setWithdrawing(h)}>
                        {t.withdraw}
                        <span className="sr-only"> {h.title}</span>
                      </Button>
                    </span>
                  )}
                </div>
                {h.details && <p className="text-body text-ink-muted">{h.details}</p>}
                {h.files.length > 0 && (
                  <span className="flex flex-wrap gap-3">
                    {h.files.map((f) => (
                      <a
                        key={f.fileId}
                        href={`/api/v1/school/homework/${h.id}/files/${f.fileId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-caption text-navy-950 underline"
                      >
                        <FileText aria-hidden className="size-4" />
                        {f.fileName}
                      </a>
                    ))}
                  </span>
                )}
                <span className="text-caption text-ink-muted tabular-nums">
                  {[
                    t.setBy(h.setByName),
                    ...h.sections.map((s) => t.doneOf(s.done, s.of, s.label)),
                  ].join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t.diaryTitle(view.data.section)} flush>
        {days.length === 0 ? (
          <EmptyState compact art="exams" title={t.noDiary} />
        ) : (
          <div className="divide-y divide-line">
            {days.map((d) => (
              <div key={d} className="flex flex-col gap-2 px-5 py-3">
                <h3 className="text-caption font-medium text-ink-muted">{dayText(d)}</h3>
                <ul className="flex flex-col gap-2">
                  {view.data.diary
                    .filter((e) => e.onDate === d)
                    .map((e) => (
                      <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1 text-body text-ink">
                          <span className="font-medium">{e.subject ?? t.generalNote}:</span>{' '}
                          {e.body}
                          <span className="block text-caption text-ink-muted">
                            {e.writtenByName}
                            {e.editedAt ? ` · ${t.edited}` : ''}
                          </span>
                        </span>
                        {e.mine && (
                          <Button size="sm" variant="secondary" onClick={() => setEditingEntry(e)}>
                            {t.edit}
                            <span className="sr-only"> {e.subject ?? t.generalNote}</span>
                          </Button>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>
      {editing && (
        <HomeworkForm
          institutionId={editing.institutionId}
          classes={[cls]}
          first={cls}
          defaultDue={editing.dueOn}
          today={editing.setOn}
          homework={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {withdrawing && (
        <WithdrawConfirm
          h={withdrawing}
          onClose={() => setWithdrawing(null)}
          onDone={() => {
            setWithdrawing(null);
            onChanged();
          }}
        />
      )}
      {editingEntry && (
        <EntryEdit
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onDone={() => {
            setEditingEntry(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function HomeworkForm({
  institutionId,
  classes,
  first,
  defaultDue,
  today,
  homework,
  onClose,
  onDone,
}: {
  institutionId: string;
  classes: MyClass[];
  first: MyClass;
  defaultDue: string;
  today: string;
  homework?: Homework | undefined;
  onClose: () => void;
  onDone: (w: DueWarning) => void;
}) {
  const [subjectId, setSubjectId] = useState(
    homework?.subjectId ?? first.subjects[0]?.subjectId ?? '',
  );
  const [sectionIds, setSectionIds] = useState<string[]>([first.sectionId]);
  const [title, setTitle] = useState(homework?.title ?? '');
  const [details, setDetails] = useState(homework?.details ?? '');
  const [dueOn, setDueOn] = useState(homework?.dueOn ?? defaultDue);
  const [files, setFiles] = useState<Attachment[]>(homework?.files ?? []);
  const [failed, setFailed] = useState<File | null>(null);
  const subjects = [
    ...new Map(classes.flatMap((c) => c.subjects).map((s) => [s.subjectId, s])).values(),
  ];
  // Classes where the person can set this subject.
  const able = classes.filter((c) => c.subjects.some((s) => s.subjectId === subjectId));
  const chosen = sectionIds.filter((sid) => able.some((c) => c.sectionId === sid));
  const upload = useMutation({
    mutationFn: (file: File) =>
      api.upload<Attachment>(`/school/homework/files?institutionId=${institutionId}`, file),
    onSuccess: (a) => {
      setFailed(null);
      setFiles((cur) => [...cur, { fileId: a.fileId, fileName: a.fileName }]);
    },
    onError: (_e, file) => setFailed(file),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { title, details, dueOn, fileIds: files.map((f) => f.fileId) };
      return homework
        ? api.put<{ warning: DueWarning }>(`/school/homework/${homework.id}`, body)
        : api.post<{ id: string; warning: DueWarning }>('/school/homework', {
            ...body,
            institutionId,
            subjectId,
            sectionIds: chosen,
          });
    },
    onSuccess: (r) => onDone(r.warning),
  });
  return (
    <FormModal
      title={homework ? t.editTitle : t.set}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={
        !title.trim() || !dueOn || upload.isPending || (!homework && chosen.length === 0)
      }
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {!homework && (
        <>
          <ModalField label={t.subject} wide>
            <select
              className={fieldInput}
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              {subjects.map((s) => (
                <option key={s.subjectId} value={s.subjectId}>
                  {s.name}
                </option>
              ))}
            </select>
          </ModalField>
          <fieldset className="col-span-full flex flex-col gap-2">
            <legend className="mb-1 text-caption font-medium text-ink">{t.sections}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {able.map((c) => (
                <label key={c.sectionId} className="flex items-center gap-2 text-body text-ink">
                  <input
                    type="checkbox"
                    checked={chosen.includes(c.sectionId)}
                    onChange={(e) =>
                      setSectionIds((cur) =>
                        e.target.checked
                          ? [...cur, c.sectionId]
                          : cur.filter((x) => x !== c.sectionId),
                      )
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
      <ModalField label={t.titleLabel} hint={t.titleHint} wide>
        <input
          className={fieldInput}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.details} hint={t.detailsHint} wide>
        <textarea
          className={fieldInput}
          rows={3}
          maxLength={2000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.due}>
        <input
          type="date"
          className={fieldInput}
          min={today}
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
        />
      </ModalField>
      <div className="col-span-full flex flex-col gap-2">
        <span className="text-caption font-medium text-ink">{t.files}</span>
        <span className="text-caption text-ink-muted">{t.filesHint}</span>
        {files.length > 0 && (
          <ul className="flex flex-col gap-1">
            {files.map((f) => (
              <li key={f.fileId} className="flex items-center gap-2 text-body text-ink">
                <Paperclip aria-hidden className="size-4 text-ink-muted" />
                <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                <button
                  type="button"
                  aria-label={t.removeFile(f.fileName)}
                  onClick={() => setFiles((cur) => cur.filter((x) => x.fileId !== f.fileId))}
                  className="flex size-8 items-center justify-center rounded-lg hover:bg-paper"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {upload.isPending && upload.variables && (
          <p role="status" className="text-caption text-ink-muted">
            {t.uploading(upload.variables.name)}
          </p>
        )}
        {failed && (
          <p
            role="alert"
            className="flex flex-wrap items-center gap-2 text-caption text-signal-stop-ink"
          >
            {upload.error instanceof ApiFailure && t.errors[upload.error.code]
              ? t.errors[upload.error.code]
              : t.uploadFailed(failed.name)}
            <Button size="sm" variant="secondary" onClick={() => upload.mutate(failed)}>
              {t.retry}
            </Button>
          </p>
        )}
        {files.length < 3 && (
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-line-strong px-3 py-2 text-body text-ink hover:bg-paper focus-within:outline focus-within:outline-2 focus-within:outline-navy-950">
            <Paperclip aria-hidden className="size-4" />
            {t.addFile}
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) upload.mutate(f);
              }}
            />
          </label>
        )}
      </div>
    </FormModal>
  );
}

function DiaryForm({
  classes,
  first,
  today,
  manager,
  onClose,
  onDone,
}: {
  classes: MyClass[];
  first: MyClass;
  today: string;
  manager: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [sectionId, setSectionId] = useState(first.sectionId);
  const cls = classes.find((c) => c.sectionId === sectionId) ?? first;
  const general = cls.classTeacher || manager;
  const [subjectId, setSubjectId] = useState<string>(
    general ? '' : (cls.subjects[0]?.subjectId ?? ''),
  );
  const [onDate, setOnDate] = useState(today);
  const [body, setBody] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post('/school/homework/diary', { sectionId, onDate, subjectId: subjectId || null, body }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.write}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!body.trim() || (!general && !subjectId)}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.sections}>
        <select
          className={fieldInput}
          value={sectionId}
          onChange={(e) => {
            setSectionId(e.target.value);
            const next = classes.find((c) => c.sectionId === e.target.value);
            setSubjectId(
              next && (next.classTeacher || manager) ? '' : (next?.subjects[0]?.subjectId ?? ''),
            );
          }}
        >
          {classes.map((c) => (
            <option key={c.sectionId} value={c.sectionId}>
              {c.label}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.subject}>
        <select
          className={fieldInput}
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
        >
          {general && <option value="">{t.generalNote}</option>}
          {cls.subjects.map((s) => (
            <option key={s.subjectId} value={s.subjectId}>
              {s.name}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.date}>
        <input
          type="date"
          className={fieldInput}
          max={today}
          value={onDate}
          onChange={(e) => setOnDate(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.entry} hint={t.entryHint} wide>
        <textarea
          className={fieldInput}
          rows={4}
          maxLength={1000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function EntryEdit({
  entry,
  onClose,
  onDone,
}: {
  entry: DiaryEntry;
  onClose: () => void;
  onDone: () => void;
}) {
  const [body, setBody] = useState(entry.body);
  const save = useMutation({
    mutationFn: () => api.put(`/school/homework/diary/${entry.id}`, { body }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.editEntry}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!body.trim()}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.entry} hint={t.entryHint} wide>
        <textarea
          className={fieldInput}
          rows={4}
          maxLength={1000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function WithdrawConfirm({
  h,
  onClose,
  onDone,
}: {
  h: Homework;
  onClose: () => void;
  onDone: () => void;
}) {
  const go = useMutation({
    mutationFn: () => api.post(`/school/homework/${h.id}/withdraw`, {}),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.withdrawTitle(h.title)}
      description={t.withdrawBody}
      submitLabel={t.withdraw}
      cancelLabel={t.cancel}
      tone="danger"
      pending={go.isPending}
      error={go.error ? errorText(go.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => go.mutate()}
    >
      {null}
    </FormModal>
  );
}
