'use client';

import type { AdmissionForm, FormSection, InviteRow, Paper } from '@campusverse/school-admissions';
import {
  Announcer,
  Button,
  EmptyState,
  KeyFigures,
  PageHeader,
  Pill,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  ExternalLink,
  FileText,
  Globe,
  ListChecks,
  MessageCircle,
  Plus,
  Send,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { ProfilePanel } from '../../common/profile360';
import {
  SendFormDialog,
  YearPicker,
  admissionError,
  c,
  field,
  t,
  usePipeline,
  useYear,
  when,
} from '../shared';

const SECTIONS: FormSection[] = [
  'second_guardian',
  'address',
  'background',
  'previous_school',
  'health',
];
const DEFAULT_PAPERS: Paper[] = [
  { kind: 'birth_certificate', title: 'Birth certificate', required: true },
  { kind: 'photo', title: 'Passport-size photo', required: true },
  { kind: 'address_proof', title: 'Address proof', required: true },
  { kind: 'report_card', title: 'Last report card', required: false },
  { kind: 'transfer_certificate', title: 'Transfer certificate', required: false },
];
const kindOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/^(?![a-z])/, 'p_') || 'paper';

/** The year's application form: its link, how links to families are doing, and its settings. */
export function FormsView() {
  const school = useInstitution();
  const id = school.institutionId;
  const [year, setYear] = useYear();
  const pipeline = usePipeline(id, year);
  const [sending, setSending] = useState(false);
  const forms = useQuery({
    queryKey: ['admission-forms', id],
    queryFn: () => api.get<AdmissionForm[]>(`/school/admissions/forms?institutionId=${id}`),
    enabled: !!id,
  });
  const links = useQuery({
    queryKey: ['admission-invites', id],
    queryFn: () => api.get<InviteRow[]>(`/school/admissions/${id}/invites`),
    enabled: !!id,
  });
  if (forms.isError)
    return forms.error instanceof ApiFailure && forms.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={admissionError(forms.error)} />
    );
  const form = forms.data?.find((f) => f.yearLabel === year);
  const classes = (pipeline.data?.classes ?? []).filter((k) => k.running);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Globe}
        eyebrow={en.systems.groups.enrollment}
        title={c.forms.title}
        description={c.forms.lead}
        actions={
          form && (
            <Button onClick={() => setSending(true)} aria-haspopup="dialog">
              <Send aria-hidden className="size-4" />
              {c.send.action}
            </Button>
          )
        }
      >
        <YearPicker year={year} onChange={setYear} />
      </PageHeader>
      {forms.isPending || !id ? (
        <div className="panel">
          <SkeletonRows rows={4} label={en.states.loading.title} />
        </div>
      ) : (
        <FormEditor
          key={`${form?.id ?? 'new'}-${year}`}
          institutionId={id}
          institutionName={school.institutionName ?? ''}
          year={year}
          classes={classes}
          form={form}
          links={links.data ?? []}
        />
      )}
      {sending && id && (
        <SendFormDialog institutionId={id} year={year} onClose={() => setSending(false)} />
      )}
    </div>
  );
}

function FormEditor({
  institutionId,
  institutionName,
  year,
  classes,
  form,
  links,
}: {
  institutionId: string;
  institutionName: string;
  year: string;
  classes: { classId: string; name: string }[];
  form: AdmissionForm | undefined;
  links: InviteRow[];
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(form?.title ?? institutionName);
  const [intro, setIntro] = useState(form?.intro ?? '');
  const [classIds, setClassIds] = useState<string[]>(form?.classIds ?? []);
  const [open, setOpen] = useState(form?.open ?? true);
  const [closesOn, setClosesOn] = useState(form?.closesOn ?? '');
  const [sections, setSections] = useState<FormSection[]>(form?.sections ?? SECTIONS);
  const [papers, setPapers] = useState<Paper[]>(form?.papers ?? DEFAULT_PAPERS);
  const [newPaper, setNewPaper] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!form && classIds.length === 0 && classes.length)
      setClassIds(classes.map((k) => k.classId));
  }, [classes, form, classIds.length]);
  const link =
    form && typeof window !== 'undefined' ? `${window.location.origin}/apply/${form.slug}` : null;
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
        papers,
        sections,
      };
      return form
        ? api.put(`/school/admissions/forms/${form.id}`, body)
        : api.post('/school/admissions/forms', body);
    },
    onSuccess: () => {
      setMessage(form ? c.forms.saved : c.forms.created);
      void qc.invalidateQueries({ queryKey: ['admission-forms'] });
    },
  });
  const personal = links.filter((l) => l.purpose === 'apply');
  const saveBar = (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {save.error && (
        <p role="alert" className="flex-1 text-body text-signal-stop-ink">
          {admissionError(save.error)}
        </p>
      )}
      <Button
        disabled={save.isPending || !title.trim() || classIds.length === 0}
        onClick={() => save.mutate()}
      >
        {form ? c.forms.save : c.forms.create}
      </Button>
    </div>
  );

  return (
    <>
      {form && link ? (
        <section className="panel flex flex-col gap-5 overflow-hidden p-0">
          <div
            className="flex flex-wrap items-center gap-4 px-6 py-5"
            style={{
              background:
                'linear-gradient(115deg, #04266d 0%, hsl(218 70% 30%) 55%, hsl(206 75% 42%) 100%)',
            }}
          >
            <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 text-cyan-300">
              <FileText aria-hidden className="size-6" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-display text-lead font-semibold text-white">{form.title}</span>
              <span className="text-caption text-white/75">
                {c.forms.heroNote(year, form.applications)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-caption font-semibold text-white">
              <span
                aria-hidden
                className={cx('size-2 rounded-full', form.open ? 'bg-signal-go' : 'bg-white/50')}
              />
              {form.open ? t.onlineIsOpen : t.onlineIsClosed}
            </span>
          </div>
          <div className="flex flex-col gap-3 px-6 pb-6">
            <span className="text-caption font-medium text-ink">{t.onlineLink}</span>
            <div className="flex flex-wrap gap-2">
              <input
                readOnly
                aria-label={t.onlineLink}
                value={link}
                onFocus={(e) => e.target.select()}
                className={cx(field, 'tabular min-w-0 flex-1 bg-paper')}
              />
              <Button
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard?.writeText(link).then(
                    () => setCopied(true),
                    () => undefined,
                  )
                }
              >
                <Copy aria-hidden className="size-4" />
                {copied ? c.send.copied : t.onlineCopy}
              </Button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(c.forms.shareText(form.title, year, link))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-body font-medium text-ink shadow-[var(--shadow-card)] hover:bg-navy-50"
              >
                <MessageCircle aria-hidden className="size-4" />
                {c.forms.share}
              </a>
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-body font-medium text-ink shadow-[var(--shadow-card)] hover:bg-navy-50"
              >
                <ExternalLink aria-hidden className="size-4" />
                {c.forms.preview}
              </a>
            </div>
            <p className="text-caption text-ink-muted" aria-live="polite">
              {copied ? t.onlineCopied : c.forms.linkNote}
            </p>
          </div>
        </section>
      ) : (
        <div className="panel">
          <EmptyState art="admissions" title={t.onlineNone(year)} body={c.forms.setUpLead} />
        </div>
      )}

      {form && (
        <KeyFigures
          variant="strip"
          label={c.forms.links}
          figures={[
            {
              label: c.forms.fig.applications,
              value: String(form.applications),
              valueTone: 'navy',
            },
            { label: c.forms.fig.sent, value: String(personal.length) },
            { label: c.forms.fig.opened, value: String(personal.filter((l) => l.openedAt).length) },
            {
              label: c.forms.fig.submitted,
              value: String(personal.filter((l) => l.submittedAt).length),
              tone: 'go',
            },
          ]}
        />
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <ProfilePanel title={c.forms.basics} icon={Settings2} description={c.forms.basicsLead}>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.onlineFormTitle}</span>
            <input
              className={field}
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <span className="text-caption text-ink-muted">{t.onlineFormTitleHint}</span>
          </label>
          <label className="flex flex-col gap-1.5">
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
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-caption font-medium text-ink">{t.onlineClasses}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {classes.map((k) => (
                <label key={k.classId} className="flex items-center gap-2 text-body text-ink">
                  <input
                    type="checkbox"
                    className="size-4 accent-[#04266d]"
                    checked={classIds.includes(k.classId)}
                    onChange={(e) =>
                      setClassIds((cur) =>
                        e.target.checked ? [...cur, k.classId] : cur.filter((x) => x !== k.classId),
                      )
                    }
                  />
                  {k.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2.5 self-end pb-2 text-body text-ink">
              <input
                type="checkbox"
                className="size-4 accent-[#04266d]"
                checked={open}
                onChange={(e) => setOpen(e.target.checked)}
              />
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
            </label>
          </div>
        </ProfilePanel>

        <div className="flex flex-col gap-6">
          <ProfilePanel
            title={c.forms.sections}
            icon={ListChecks}
            description={c.forms.sectionsLead}
          >
            <ul className="flex flex-col gap-2">
              <li className="flex items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2.5">
                <span className="text-body text-ink">{c.forms.always}</span>
                <Pill>{c.forms.alwaysAsked}</Pill>
              </li>
              {SECTIONS.map((s) => (
                <li key={s}>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
                    <span className="flex flex-col">
                      <span className="text-body font-medium text-ink">
                        {c.forms.sectionNames[s]}
                      </span>
                      <span className="text-caption text-ink-muted">{c.forms.sectionHints[s]}</span>
                    </span>
                    <input
                      type="checkbox"
                      className="size-4 accent-[#04266d]"
                      checked={sections.includes(s)}
                      onChange={(e) =>
                        setSections((cur) =>
                          e.target.checked ? [...cur, s] : cur.filter((x) => x !== s),
                        )
                      }
                    />
                  </label>
                </li>
              ))}
            </ul>
          </ProfilePanel>

          <ProfilePanel title={c.forms.papers} icon={FileText} description={c.forms.papersLead}>
            <ul className="flex flex-col gap-2">
              {papers.map((p, i) => (
                <li
                  key={p.kind}
                  className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
                >
                  <input
                    aria-label={c.forms.paperTitle(i + 1)}
                    value={p.title}
                    maxLength={80}
                    onChange={(e) =>
                      setPapers((cur) =>
                        cur.map((x, n) => (n === i ? { ...x, title: e.target.value } : x)),
                      )
                    }
                    className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none"
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-caption text-ink-muted">
                    <input
                      type="checkbox"
                      className="size-4 accent-[#04266d]"
                      checked={p.required}
                      onChange={(e) =>
                        setPapers((cur) =>
                          cur.map((x, n) => (n === i ? { ...x, required: e.target.checked } : x)),
                        )
                      }
                    />
                    {c.forms.required}
                  </label>
                  <button
                    type="button"
                    aria-label={c.forms.removePaper(p.title)}
                    onClick={() => setPapers((cur) => cur.filter((x) => x.kind !== p.kind))}
                    className="inline-flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-signal-stop-tint hover:text-signal-stop-ink"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                aria-label={c.forms.addPaper}
                placeholder={c.forms.addPaperPlaceholder}
                value={newPaper}
                maxLength={80}
                onChange={(e) => setNewPaper(e.target.value)}
                className={cx(field, 'min-w-0 flex-1')}
              />
              <Button
                variant="secondary"
                disabled={
                  !newPaper.trim() ||
                  papers.length >= 12 ||
                  papers.some((p) => p.kind === kindOf(newPaper))
                }
                onClick={() => {
                  setPapers((cur) => [
                    ...cur,
                    { kind: kindOf(newPaper), title: newPaper.trim(), required: false },
                  ]);
                  setNewPaper('');
                }}
              >
                <Plus aria-hidden className="size-4" />
                {c.forms.add}
              </Button>
            </div>
          </ProfilePanel>
        </div>
      </div>
      {saveBar}

      {personal.length > 0 && (
        <section aria-labelledby="links" className="panel overflow-hidden">
          <h2
            id="links"
            className="border-b border-line px-5 py-3.5 font-display text-body font-semibold text-ink"
          >
            {c.forms.links}
          </h2>
          <ul className="divide-y divide-line">
            {personal.slice(0, 50).map((l) => (
              <LinkRow key={l.id} l={l} />
            ))}
          </ul>
        </section>
      )}
      <Announcer message={message} />
    </>
  );
}

function LinkRow({ l }: { l: InviteRow }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api.post(`/school/admissions/invites/${l.id}/cancel`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admission-invites'] }),
  });
  const expired = Date.parse(l.expiresAt) < Date.now();
  const state = l.cancelledAt
    ? 'cancelled'
    : l.submittedAt
      ? 'submitted'
      : expired
        ? 'expired'
        : l.openedAt
          ? 'opened'
          : 'sent';
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-ink">
          {l.childName ?? l.guardianName ?? c.forms.anyFamily}
        </span>
        <span className="truncate text-caption text-ink-muted">
          {[c.send.channels[l.channel], l.address, c.forms.sentBy(l.sentBy, when(l.sentAt))]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <Pill tone={state === 'submitted' ? 'go' : state === 'opened' ? 'warn' : 'neutral'}>
        {c.forms.linkState[state]}
      </Pill>
      {(state === 'sent' || state === 'opened') && (
        <Button
          size="sm"
          variant="quiet"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          {c.forms.cancelLink}
        </Button>
      )}
    </li>
  );
}
