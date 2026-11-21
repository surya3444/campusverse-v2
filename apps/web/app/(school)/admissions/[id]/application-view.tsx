'use client';

import type {
  ApplicationRecord,
  Enrolled,
  PaperLine,
  SentInvite,
  TimelineItem,
} from '@campusverse/school-admissions';
import {
  Announcer,
  Button,
  FormModal,
  ModalField,
  Pill,
  Segmented,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarCheck2,
  CalendarClock,
  Cake,
  Check,
  CircleDashed,
  ClipboardList,
  Eye,
  FileCheck2,
  FileClock,
  FileText,
  FileUp,
  FileX2,
  HeartPulse,
  Home,
  IndianRupee,
  Inbox,
  Link2,
  NotebookPen,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Tabs } from 'radix-ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { rupees } from '../../../../lib/money';
import { STATES } from '@campusverse/rules';
import { en } from '../../../../messages/en';
import { RecordStamp } from '../../common/activity';
import { CustomFields, changedValues, useFields, type Values } from '../../common/custom-fields';
import { ImageUpload } from '../../common/image-upload';
import { InfoGrid, ProfileHero, ProfilePanel, ProfileTabsList } from '../../common/profile360';
import { ReasonDialog } from '../../reason-dialog';
import { CompleteFollowUpDialog, KIND_ICON, LogActivityDialog } from '../activity';
import {
  ContactActions,
  SendFormDialog,
  SentDialog,
  StagePill,
  admissionError,
  c,
  daysTo,
  field,
  plusDays,
  relDay,
  shortDate,
  t,
  useCounsellors,
  when,
} from '../shared';

type Rec = ApplicationRecord;
const r = c.record;

const MOVES: Record<string, string[]> = {
  enquiry: ['contacted', 'applied'],
  contacted: ['applied'],
  applied: ['documents_pending', 'under_review', 'waitlisted'],
  documents_pending: ['under_review', 'waitlisted'],
  under_review: ['documents_pending', 'waitlisted'],
  waitlisted: ['under_review'],
};
const CLOSE: Record<string, string[]> = {
  enquiry: ['lost'],
  contacted: ['lost'],
  applied: ['rejected', 'withdrawn'],
  documents_pending: ['rejected', 'withdrawn'],
  under_review: ['rejected', 'withdrawn'],
  offered: ['withdrawn', 'lost'],
  waitlisted: ['withdrawn', 'lost'],
  confirmed: ['withdrawn'],
};
const STEPS = ['enquiry', 'applied', 'verified', 'offered', 'confirmed', 'enrolled'] as const;
const stepOf = (a: Rec): number => {
  if (a.state === 'enrolled') return 5;
  if (a.state === 'confirmed') return 4;
  if (a.state === 'offered') return 3;
  if (a.verifiedAt || a.state === 'under_review' || a.state === 'waitlisted') return 2;
  if (a.state === 'applied' || a.state === 'documents_pending') return 1;
  return 0;
};

export function ApplicationView({ id }: { id: string }) {
  const qc = useQueryClient();
  const key = ['application', id];
  const app = useQuery({
    queryKey: key,
    queryFn: () => api.get<Rec>(`/school/admissions/applications/${id}`),
  });
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'send' }
    | { kind: 'log' }
    | { kind: 'edit' }
    | { kind: 'follow' }
    | { kind: 'papers' }
    | { kind: 'close'; to: string }
    | { kind: 'override' }
    | null
  >(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['admissions'] });
    void qc.invalidateQueries({ queryKey: ['stamps'] });
  };

  if (app.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (app.isError)
    return app.error instanceof ApiFailure && app.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={admissionError(app.error)} />
    );
  const a = app.data;
  const years =
    a.age.status === 'ok' || a.age.status === 'too_young' || a.age.status === 'too_old'
      ? a.age.years
      : null;
  const open = !['enrolled', 'lost', 'withdrawn', 'rejected'].includes(a.state);
  const canSend = ['enquiry', 'contacted', 'applied', 'documents_pending'].includes(a.state);
  const lead = {
    id: a.id,
    childName: a.childName,
    guardianName: a.guardianName,
    guardianPhone: a.guardianPhone,
    guardianEmail: a.details.guardianEmail,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/admissions?year=${a.yearLabel}`}
          className="inline-flex items-center gap-2 rounded-lg px-1 text-body font-medium text-ink hover:text-navy-950"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {r.back}
        </Link>
        <span className="flex-1" />
        <ContactActions
          phone={a.guardianPhone}
          email={a.details.guardianEmail}
          name={a.guardianName}
        />
        {open && (
          <Button variant="secondary" onClick={() => setDialog({ kind: 'log' })}>
            <NotebookPen aria-hidden className="size-4" />
            {r.log}
          </Button>
        )}
        {canSend && (
          <Button variant="secondary" onClick={() => setDialog({ kind: 'send' })}>
            <Send aria-hidden className="size-4" />
            {c.send.action}
          </Button>
        )}
      </div>

      <ProfileHero
        label={`${a.className} · ${a.yearLabel}`}
        labelIcon={UserPlus}
        photo={
          <ImageUpload
            compact
            label={en.myProfile.photo}
            name={a.childName}
            src={`/api/v1/school/admissions/applications/${id}/photo`}
            currentFileId={a.photoFileId}
            uploadPath={`/school/admissions/applications/${id}/photo`}
            canEdit={a.state !== 'enrolled'}
            onChanged={refresh}
          />
        }
        name={a.childName}
        status={<StagePill state={a.state} />}
        subtitle={[
          a.reference && r.ref(a.reference),
          a.consentedAt ? r.viaForm : (t.sources[a.source] ?? a.source),
          a.campaign,
        ]
          .filter(Boolean)
          .join(' · ')}
        contact={
          <span>
            {a.guardianName} ({t.relationships[a.guardianRelationship] ?? a.guardianRelationship})
            {' · '}
            <span className="tabular">{a.guardianPhone}</span>
            {a.details.guardianEmail && ` · ${a.details.guardianEmail}`}
          </span>
        }
        stamp={<RecordStamp id={id} />}
        chips={[
          ...(years !== null ? [{ icon: Cake, label: r.age(years) }] : []),
          { icon: Tag, label: t.categories[a.category] ?? a.category },
          { icon: Users, label: a.owner ? r.ownedBy(a.owner.name) : c.unassigned },
          ...(a.siblings.length
            ? [
                {
                  icon: Sparkles,
                  label: r.sibling(a.siblings.map((s) => s.studentName).join(', ')),
                },
              ]
            : []),
          ...(a.verifiedAt
            ? [
                {
                  icon: ShieldCheck,
                  label: r.verifiedBy(a.verifiedBy ?? '', shortDate(a.verifiedAt)),
                },
              ]
            : []),
        ]}
      />

      <Stepper a={a} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Tabs.Root defaultValue="overview" className="flex min-w-0 flex-col gap-5">
          <ProfileTabsList
            label={a.childName}
            tabs={(['overview', 'details', 'papers', 'activity', 'fees'] as const).map((k) => ({
              value: k,
              label:
                k === 'papers'
                  ? r.tabs.papersN(
                      a.checklist.filter((l) => l.required && l.status === 'verified').length,
                      a.checklist.filter((l) => l.required).length,
                    )
                  : r.tabs[k],
            }))}
          />
          <Tabs.Content value="overview" className="flex flex-col gap-6">
            <OverviewTab
              a={a}
              onEdit={() => setDialog({ kind: 'edit' })}
              onOverride={() => setDialog({ kind: 'override' })}
            />
          </Tabs.Content>
          <Tabs.Content value="details" className="flex flex-col gap-6">
            <DetailsTab a={a} onEdit={() => setDialog({ kind: 'edit' })} onSaved={refresh} />
          </Tabs.Content>
          <Tabs.Content value="papers" className="flex flex-col gap-6">
            <PapersTab
              a={a}
              onChanged={refresh}
              onAsk={() => setDialog({ kind: 'papers' })}
              onMessage={setMessage}
            />
          </Tabs.Content>
          <Tabs.Content value="activity" className="flex flex-col gap-6">
            <ActivityTab a={a} onLog={() => setDialog({ kind: 'log' })} />
          </Tabs.Content>
          <Tabs.Content value="fees">
            <FeesTab a={a} />
          </Tabs.Content>
        </Tabs.Root>

        <aside className="flex flex-col gap-6" aria-label={r.aside}>
          <NextStep
            a={a}
            onChanged={refresh}
            onMessage={setMessage}
            onSend={() => setDialog({ kind: 'send' })}
            onAsk={() => setDialog({ kind: 'papers' })}
            onClose={(to) => setDialog({ kind: 'close', to })}
          />
          {open && <FollowUps a={a} onSchedule={() => setDialog({ kind: 'follow' })} />}
          {open && <LeadPanel a={a} onSaved={refresh} />}
          {a.invites.length > 0 && <Links a={a} />}
        </aside>
      </div>

      {dialog?.kind === 'send' && a.institutionId && (
        <SendFormDialog
          institutionId={a.institutionId}
          year={a.yearLabel}
          lead={lead}
          onClose={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'log' && (
        <LogActivityDialog
          applicationId={id}
          childName={a.childName}
          onClose={() => setDialog(null)}
          onDone={() => setMessage(c.log.saved)}
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditDetails
          a={a}
          onClose={() => setDialog(null)}
          onSaved={() => {
            refresh();
            setMessage(r.saved);
          }}
        />
      )}
      {dialog?.kind === 'follow' && (
        <ScheduleFollowUp a={a} onClose={() => setDialog(null)} onSaved={refresh} />
      )}
      {dialog?.kind === 'papers' && (
        <AskForPapers
          a={a}
          onClose={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'close' && (
        <ReasonDialog
          title={t.reasonTitle(t.states[dialog.to] ?? dialog.to)}
          hint={t.reasonHint}
          label={t.reason}
          action={r.closeAs(t.states[dialog.to] ?? dialog.to)}
          cancel={en.form.cancel}
          minLength={3}
          errorText={admissionError}
          onClose={() => setDialog(null)}
          submit={async (reason) => {
            await api.post(`/school/admissions/applications/${id}/move`, { to: dialog.to, reason });
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'override' && (
        <AgeOverride id={id} onClose={() => setDialog(null)} onSaved={refresh} />
      )}
      <Announcer message={message} />
    </div>
  );
}

/** Where the family is on the way to enrolment. */
function Stepper({ a }: { a: Rec }) {
  const at = stepOf(a);
  const closed = ['lost', 'withdrawn', 'rejected'].includes(a.state);
  return (
    <nav aria-label={r.progress} className="panel px-5 py-4">
      {closed && (
        <p className="mb-3 rounded-lg bg-paper px-3 py-2 text-body text-ink">
          {r.closed(t.states[a.state] ?? a.state, a.closedReason ?? '')}
        </p>
      )}
      <ol className="flex items-center gap-1 overflow-x-auto">
        {STEPS.map((s, i) => {
          const done = !closed && i < at;
          const here = !closed && i === at;
          return (
            <li
              key={s}
              className="flex min-w-fit flex-1 items-center gap-1"
              aria-current={here ? 'step' : undefined}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cx(
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
                    done
                      ? 'bg-signal-go text-white'
                      : here
                        ? 'bg-navy-950 text-white ring-4 ring-navy-950/10'
                        : 'border border-line-strong text-ink-muted',
                  )}
                >
                  {done ? <Check aria-hidden className="size-4" /> : i + 1}
                </span>
                <span
                  className={cx(
                    'text-body whitespace-nowrap',
                    here ? 'font-semibold text-ink' : done ? 'text-ink' : 'text-ink-muted',
                  )}
                >
                  {r.steps[s]}
                  <span className="sr-only">
                    {done ? ` (${r.stepDone})` : here ? ` (${r.stepNow})` : ''}
                  </span>
                </span>
              </span>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cx(
                    'mx-2 h-0.5 min-w-6 flex-1 rounded-full',
                    done ? 'bg-signal-go' : 'bg-line',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The one thing to do next, explained, with what else can be done from here. */
function NextStep({
  a,
  onChanged,
  onMessage,
  onSend,
  onAsk,
  onClose,
}: {
  a: Rec;
  onChanged: () => void;
  onMessage: (m: string) => void;
  onSend: () => void;
  onAsk: () => void;
  onClose: (to: string) => void;
}) {
  const [sectionId, setSectionId] = useState(a.sections[0]?.sectionId ?? '');
  // The first day can't be before the application's year starts (admissions for next year).
  const yearLast = a.yearEnds
    ? new Date(Date.parse(`${a.yearEnds}T00:00:00Z`) - 864e5).toISOString().slice(0, 10)
    : undefined;
  const [from, setFrom] = useState(
    a.yearStarts && a.yearStarts > plusDays(0) ? a.yearStarts : plusDays(0),
  );
  const [to, setTo] = useState('');
  const [enrolled, setEnrolled] = useState<Enrolled | null>(null);
  const call = useMutation({
    mutationFn: (v: { path: string; body?: unknown }) =>
      api.post<unknown>(`/school/admissions/applications/${a.id}/${v.path}`, v.body),
    onSuccess: (res, v) => {
      if (v.path === 'enrol') {
        const e = res as Enrolled;
        setEnrolled(e);
        onMessage(t.enrolled(e.admissionNumber));
      } else if (v.path === 'offer') onMessage(t.offered((res as { expiresOn: string }).expiresOn));
      else onMessage(r.updated);
      setTo('');
      onChanged();
    },
  });
  const required = a.checklist.filter((l) => l.required);
  const allVerified = required.every((l) => l.status === 'verified');
  const toCheck = a.checklist.filter((l) => l.status === 'received').length;
  const moves = MOVES[a.state] ?? [];
  const closes = CLOSE[a.state] ?? [];

  let title: string;
  let body: ReactNode;
  let primary: ReactNode = null;
  const btn = (label: string, path: string, body?: unknown, icon?: LucideIcon) => {
    const Icon = icon;
    return (
      <Button disabled={call.isPending} onClick={() => call.mutate({ path, body })}>
        {Icon && <Icon aria-hidden className="size-4" />}
        {label}
      </Button>
    );
  };
  if (enrolled || a.state === 'enrolled') {
    title = r.next.enrolledTitle;
    body = enrolled ? (
      <>
        <p>
          {t.enrolledIn(enrolled.sectionLabel, enrolled.rollNumber)} {t.familyTold}
        </p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {enrolled.handover.map((h) => (
            <li key={h} className="flex items-start gap-2">
              <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
              {t.tasks[h] ?? h}
            </li>
          ))}
        </ul>
      </>
    ) : (
      r.next.enrolledBody
    );
    const sid = enrolled?.studentId ?? a.studentId;
    primary = sid ? (
      <Link
        href={`/students/${sid}`}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-navy-950 px-4 text-body font-medium text-white hover:bg-navy-950/90"
      >
        {t.openRecord}
      </Link>
    ) : null;
  } else if (a.state === 'enquiry' || a.state === 'contacted') {
    title = r.next.sendTitle;
    body = a.invites.some((i) => !i.cancelledAt && !i.submittedAt)
      ? r.next.sentBody
      : r.next.sendBody;
    primary = (
      <Button onClick={onSend}>
        <Send aria-hidden className="size-4" />
        {c.send.action}
      </Button>
    );
  } else if (a.state === 'applied' || a.state === 'documents_pending') {
    title = allVerified ? r.next.verifyTitle : r.next.papersTitle;
    body = allVerified
      ? r.next.verifyBody
      : toCheck
        ? r.next.checkBody(toCheck)
        : r.next.missingBody(
            required
              .filter((l) => l.status !== 'verified')
              .map((l) => l.title)
              .join(', '),
          );
    primary = (
      <>
        <Button
          disabled={!allVerified || call.isPending}
          onClick={() => call.mutate({ path: 'verify' })}
        >
          <ShieldCheck aria-hidden className="size-4" />
          {r.verify}
        </Button>
        {!allVerified && (
          <Button variant="secondary" onClick={onAsk}>
            <FileUp aria-hidden className="size-4" />
            {r.ask}
          </Button>
        )}
      </>
    );
  } else if (a.state === 'under_review' || a.state === 'waitlisted') {
    title = r.next.offerTitle;
    body = (
      <>
        {t.seatsLeft(a.seatsLeft)}. {a.fees.length === 0 ? t.noFees : r.next.offerBody}
        {a.state === 'waitlisted' &&
          a.waitlistPosition &&
          ` ${r.next.waitlist(a.waitlistPosition)}`}
      </>
    );
    primary = btn(t.offer, 'offer', undefined, BadgeCheck);
  } else if (a.state === 'offered') {
    title = r.next.acceptTitle;
    body = a.offerExpiresOn ? r.next.acceptBody(relDay(a.offerExpiresOn)) : null;
    primary = btn(t.confirm, 'confirm', undefined, Check);
  } else if (a.state === 'confirmed') {
    title = r.next.enrolTitle;
    body = r.next.enrolBody;
    primary = (
      <div className="flex w-full flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.section}</span>
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className={field}
          >
            {a.sections.map((s) => (
              <option key={s.sectionId} value={s.sectionId}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.joiningDate}</span>
          <input
            type="date"
            value={from}
            min={a.yearStarts ?? undefined}
            max={yearLast}
            onChange={(e) => setFrom(e.target.value)}
            className={field}
          />
        </label>
        {a.sections.length === 0 && (
          <p className="rounded-lg bg-signal-warn-tint px-3 py-2 text-caption text-signal-warn-ink">
            {c.years.noSection}
          </p>
        )}
        <Button
          disabled={!sectionId || call.isPending}
          onClick={() => call.mutate({ path: 'enrol', body: { sectionId, from } })}
        >
          {t.enrol}
        </Button>
        <p className="text-caption text-ink-muted">{r.next.carries}</p>
      </div>
    );
  } else {
    title = r.next.closedTitle;
    body = a.closedReason;
  }

  return (
    <section aria-labelledby="next-step" className="panel overflow-hidden">
      <div className="border-b border-line bg-navy-50/50 px-5 py-4">
        <p className="text-caption font-semibold tracking-[0.12em] text-ink-muted uppercase">
          {r.next.eyebrow}
        </p>
        <h2 id="next-step" className="mt-0.5 font-display text-lead font-semibold text-ink">
          {title}
        </h2>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        {body && <div className="text-body text-ink-muted">{body}</div>}
        {primary && <div className="flex flex-wrap gap-2">{primary}</div>}
        {call.error && (
          <p
            role="alert"
            className="rounded-md bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink"
          >
            {admissionError(call.error)}
          </p>
        )}
        {(moves.length > 0 || closes.length > 0) && !enrolled && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <span className="text-caption font-medium text-ink">{r.more}</span>
            <div className="flex gap-2">
              <select
                aria-label={r.more}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={cx(field, 'h-9 flex-1')}
              >
                <option value="">{r.choose}</option>
                {moves.map((s) => (
                  <option key={s} value={s}>
                    {r.moveTo(t.states[s] ?? s)}
                  </option>
                ))}
                {closes.map((s) => (
                  <option key={s} value={s}>
                    {r.closeAs(t.states[s] ?? s)}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                className="h-9"
                disabled={!to || call.isPending}
                onClick={() =>
                  closes.includes(to) ? onClose(to) : call.mutate({ path: 'move', body: { to } })
                }
              >
                {t.moveAction}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function FollowUps({ a, onSchedule }: { a: Rec; onSchedule: () => void }) {
  const [done, setDone] = useState<Rec['followUps'][number] | null>(null);
  return (
    <ProfilePanel
      title={c.followUps.title}
      icon={CalendarCheck2}
      action={
        <Button size="sm" variant="quiet" onClick={onSchedule}>
          <Plus aria-hidden className="size-4" />
          {r.schedule}
        </Button>
      }
    >
      {a.followUps.length === 0 ? (
        <p className="text-body text-ink-muted">{r.noFollowUps}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {a.followUps.map((f) => {
            const late = daysTo(f.dueOn) < 0;
            return (
              <li
                key={f.id}
                className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5"
              >
                <CalendarClock
                  aria-hidden
                  className={cx(
                    'mt-0.5 size-4 shrink-0',
                    late ? 'text-signal-stop-ink' : 'text-ink-muted',
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink">{f.purpose}</span>
                  <span
                    className={cx(
                      'text-caption',
                      late ? 'font-medium text-signal-stop-ink' : 'text-ink-muted',
                    )}
                  >
                    {relDay(f.dueOn)} · {f.assignedTo}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => setDone(f)}
                  aria-label={c.followUps.markDoneFor(f.purpose)}
                >
                  <Check aria-hidden className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {done && (
        <CompleteFollowUpDialog
          followUpId={done.id}
          childName={a.childName}
          purpose={done.purpose}
          onClose={() => setDone(null)}
        />
      )}
    </ProfilePanel>
  );
}

function LeadPanel({ a, onSaved }: { a: Rec; onSaved: () => void }) {
  const counsellors = useCounsellors(a.institutionId);
  const [campaign, setCampaign] = useState(a.campaign ?? '');
  useEffect(() => setCampaign(a.campaign ?? ''), [a.campaign]);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post(`/school/admissions/applications/${a.id}/lead`, body),
    onSuccess: onSaved,
  });
  return (
    <ProfilePanel title={r.leadPanel} icon={Inbox}>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{c.owner}</span>
        <select
          value={a.owner?.personId ?? ''}
          onChange={(e) => save.mutate({ ownerPersonId: e.target.value || null })}
          className={field}
        >
          <option value="">{c.unassigned}</option>
          {(counsellors.data ?? []).map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-1.5">
        <span id="interest-label" className="text-caption font-medium text-ink">
          {c.interestLabel}
        </span>
        <Segmented
          label={c.interestLabel}
          value={a.interest ?? 'none'}
          onChange={(v) => save.mutate({ interest: v === 'none' ? null : v })}
          options={[
            { value: 'hot', label: c.interest.hot ?? '' },
            { value: 'warm', label: c.interest.warm ?? '' },
            { value: 'cold', label: c.interest.cold ?? '' },
            { value: 'none', label: '—' },
          ]}
        />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{c.campaign}</span>
        <input
          value={campaign}
          maxLength={60}
          onChange={(e) => setCampaign(e.target.value)}
          onBlur={() =>
            campaign !== (a.campaign ?? '') && save.mutate({ campaign: campaign || null })
          }
          className={field}
        />
      </label>
      <p className="text-caption text-ink-muted" aria-live="polite">
        {save.error ? admissionError(save.error) : save.isSuccess ? r.updated : ''}
      </p>
    </ProfilePanel>
  );
}

function Links({ a }: { a: Rec }) {
  return (
    <ProfilePanel title={r.links} icon={Link2}>
      <ul className="flex flex-col gap-2">
        {a.invites.slice(0, 5).map((l) => {
          const state = l.cancelledAt
            ? 'cancelled'
            : l.submittedAt
              ? 'submitted'
              : Date.parse(l.expiresAt) < Date.now()
                ? 'expired'
                : l.openedAt
                  ? 'opened'
                  : 'sent';
          return (
            <li
              key={l.id}
              className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body text-ink">
                  {l.purpose === 'papers' ? r.papersLink : r.applyLink}
                </span>
                <span className="truncate text-caption text-ink-muted">
                  {c.send.channels[l.channel]} · {when(l.sentAt)}
                </span>
              </span>
              <Pill tone={state === 'submitted' ? 'go' : state === 'opened' ? 'warn' : 'neutral'}>
                {c.forms.linkState[state]}
              </Pill>
            </li>
          );
        })}
      </ul>
    </ProfilePanel>
  );
}

const dash = (v: string | null | undefined) => v || '—';

function OverviewTab({
  a,
  onEdit,
  onOverride,
}: {
  a: Rec;
  onEdit: () => void;
  onOverride: () => void;
}) {
  const d = a.details;
  const age = a.age;
  const ageText =
    age.status === 'ok' || age.status === 'too_young' || age.status === 'too_old'
      ? t.ages[age.status](age.years, age.cutOffDate)
      : t.ages[age.status];
  const ageBad = (age.status === 'too_young' || age.status === 'too_old') && !a.ageOverrideReason;
  const edit = (
    <Button size="sm" variant="quiet" onClick={onEdit}>
      <Pencil aria-hidden className="size-4" />
      {r.edit}
    </Button>
  );
  return (
    <>
      {ageBad && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-signal-stop/30 bg-signal-stop-tint px-4 py-3"
        >
          <span className="flex-1 text-body text-signal-stop-ink">{ageText}</span>
          <Button size="sm" variant="secondary" onClick={onOverride}>
            {t.overrideTitle}
          </Button>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfilePanel title={t.child} icon={Cake} action={edit}>
          <InfoGrid
            items={[
              {
                label: t.dateOfBirth,
                value: a.dateOfBirth
                  ? shortDate(a.dateOfBirth) + ` ${a.dateOfBirth.slice(0, 4)}`
                  : null,
              },
              { label: c.gender, value: a.gender ? c.genders[a.gender] : null },
              { label: t.className, value: a.className },
              {
                label: t.age,
                value: <span className={cx(ageBad && 'text-signal-stop-ink')}>{ageText}</span>,
              },
              ...(a.ageOverrideReason
                ? [
                    {
                      label: r.override,
                      value: t.override(a.ageOverrideReason, a.ageOrderRef ?? ''),
                    },
                  ]
                : []),
            ]}
          />
        </ProfilePanel>
        <ProfilePanel title={r.family} icon={Users} action={edit}>
          <InfoGrid
            items={[
              {
                label: t.guardian,
                value: `${a.guardianName} (${t.relationships[a.guardianRelationship] ?? a.guardianRelationship})`,
              },
              { label: t.guardianPhone, value: <span className="tabular">{a.guardianPhone}</span> },
              { label: c.email, value: dash(d.guardianEmail) },
              {
                label: r.secondGuardian,
                value: d.secondGuardianName
                  ? `${d.secondGuardianName} (${t.relationships[d.secondGuardianRelationship ?? ''] ?? d.secondGuardianRelationship})${d.secondGuardianPhone ? ` · ${d.secondGuardianPhone}` : ''}`
                  : null,
              },
            ]}
          />
        </ProfilePanel>
      </div>
      <ProfilePanel title={r.home} icon={Home} action={edit}>
        <InfoGrid
          items={[
            {
              label: r.address,
              value:
                [
                  d.addressLine,
                  d.city,
                  d.pincode,
                  d.stateCode && (STATES as Record<string, string>)[d.stateCode],
                ]
                  .filter(Boolean)
                  .join(', ') || null,
            },
            { label: r.previousSchool, value: dash(d.previousSchool) },
            { label: r.motherTongue, value: dash(d.motherTongue) },
            { label: r.nationality, value: dash(d.nationality) },
          ]}
        />
      </ProfilePanel>
      {a.siblings.length > 0 && (
        <p className="rounded-xl bg-signal-warn-tint px-4 py-3 text-body text-signal-warn-ink">
          {t.siblingFound(a.siblings.map((s) => s.studentName).join(', '))}
        </p>
      )}
    </>
  );
}

function DetailsTab({ a, onEdit, onSaved }: { a: Rec; onEdit: () => void; onSaved: () => void }) {
  const d = a.details;
  const edit = (
    <Button size="sm" variant="secondary" onClick={onEdit}>
      <Pencil aria-hidden className="size-4" />
      {r.editAll}
    </Button>
  );
  return (
    <>
      <ProfilePanel
        title={r.background}
        icon={ClipboardList}
        description={r.backgroundLead}
        action={edit}
      >
        <InfoGrid
          items={[
            { label: r.placeOfBirth, value: dash(d.placeOfBirth) },
            { label: r.bloodGroup, value: dash(d.bloodGroup) },
            { label: r.religion, value: dash(d.religion) },
            {
              label: r.socialCategory,
              value: d.socialCategory ? r.categories[d.socialCategory] : null,
            },
          ]}
        />
      </ProfilePanel>
      <ProfilePanel title={r.health} icon={HeartPulse} description={r.healthLead}>
        <InfoGrid
          items={[
            { label: r.disability, value: dash(d.disability) },
            { label: r.medicalNotes, value: dash(d.medicalNotes) },
          ]}
        />
      </ProfilePanel>
      <OwnQuestions id={a.id} saved={a.custom} onSaved={onSaved} />
    </>
  );
}

function OwnQuestions({ id, saved, onSaved }: { id: string; saved: Values; onSaved: () => void }) {
  const fields = useFields('admission');
  const [values, setValues] = useState<Values>(saved);
  useEffect(() => setValues(saved), [saved]);
  const changed = fields.data ? changedValues(fields.data, saved, values) : {};
  const save = useMutation({
    mutationFn: () => api.post(`/school/admissions/applications/${id}/update`, { custom: changed }),
    onSuccess: onSaved,
  });
  if (!fields.data || fields.data.length === 0) return null;
  return (
    <ProfilePanel
      title={en.customFields.title}
      icon={FileText}
      action={
        <Button
          size="sm"
          disabled={Object.keys(changed).length === 0 || save.isPending}
          onClick={() => save.mutate()}
        >
          {en.settings.save}
        </Button>
      }
    >
      <CustomFields
        fields={fields.data}
        values={values}
        onChange={(k, v) => setValues((x) => ({ ...x, [k]: v }))}
        problems={
          save.error instanceof ApiFailure && save.error.code === 'values'
            ? ((save.error.details as { problems?: Record<string, string> } | null)?.problems ?? {})
            : {}
        }
        idPrefix="admission"
      />
    </ProfilePanel>
  );
}

const PAPER_ICON: Record<PaperLine['status'], LucideIcon> = {
  missing: CircleDashed,
  received: FileClock,
  verified: FileCheck2,
  rejected: FileX2,
};
const PAPER_TONE: Record<PaperLine['status'], string> = {
  missing: 'bg-paper text-ink-muted',
  received: 'bg-signal-warn-tint text-signal-warn-ink',
  verified: 'bg-signal-go-tint text-signal-go-ink',
  rejected: 'bg-signal-stop-tint text-signal-stop-ink',
};

/** The papers checklist: each one the form asks for, its latest copy and the verifier's call. */
function PapersTab({
  a,
  onChanged,
  onAsk,
  onMessage,
}: {
  a: Rec;
  onChanged: () => void;
  onAsk: () => void;
  onMessage: (m: string) => void;
}) {
  const [rejecting, setRejecting] = useState<PaperLine | null>(null);
  const [upload, setUpload] = useState<PaperLine | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const check = useMutation({
    mutationFn: (v: { documentId: string; status: 'verified' | 'rejected'; note?: string }) =>
      api.post(`/school/admissions/applications/documents/${v.documentId}/check`, {
        status: v.status,
        note: v.note ?? null,
      }),
    onSuccess: (_r, v) => {
      onMessage(v.status === 'verified' ? r.paperAccepted : r.paperRejected);
      onChanged();
    },
  });
  const send = useMutation({
    mutationFn: (v: { line: PaperLine; file: File }) =>
      api.upload(`/school/admissions/applications/${a.id}/documents`, v.file, {
        folder:
          v.line.kind === 'report_card'
            ? 'academic'
            : v.line.kind === 'transfer_certificate'
              ? 'transfer'
              : 'identity',
        kind: v.line.kind,
        title: v.line.title,
      }),
    onSuccess: () => {
      setUpload(null);
      onMessage(r.paperUploaded);
      onChanged();
    },
  });
  const verify = useMutation({
    mutationFn: () => api.post(`/school/admissions/applications/${a.id}/verify`),
    onSuccess: () => {
      onMessage(r.verifiedNow);
      onChanged();
    },
  });
  const required = a.checklist.filter((l) => l.required);
  const done = required.filter((l) => l.status === 'verified').length;
  const editable = a.state !== 'enrolled';
  return (
    <ProfilePanel
      title={r.checklist}
      icon={FileCheck2}
      description={a.state === 'enrolled' ? t.papersMoved : r.checklistLead}
      action={
        <span className="tabular rounded-full bg-navy-50 px-3 py-1 text-caption font-semibold text-navy-950">
          {r.ofRequired(done, required.length)}
        </span>
      }
    >
      <ul className="flex flex-col gap-2">
        {a.checklist.map((l) => {
          const Icon = PAPER_ICON[l.status];
          return (
            <li
              key={l.kind}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3"
            >
              <span
                className={cx(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                  PAPER_TONE[l.status],
                )}
              >
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{l.title}</span>
                  {l.required ? (
                    <Pill>{c.forms.required}</Pill>
                  ) : (
                    <span className="text-caption text-ink-muted">{c.optional}</span>
                  )}
                </span>
                <span className="text-caption text-ink-muted">
                  {l.status === 'missing'
                    ? r.paperMissing
                    : [
                        r.paperStatus[l.status],
                        l.fromFamily ? r.fromFamily : r.fromOffice,
                        l.at && when(l.at),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </span>
                {l.status === 'rejected' && l.note && (
                  <span className="text-caption font-medium text-signal-stop-ink">
                    {r.rejectedBecause(l.note)}
                  </span>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {l.documentId && (
                  <a
                    href={`/api/v1/school/admissions/applications/documents/${l.documentId}/file`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-caption font-medium text-navy-950 hover:bg-navy-50"
                    aria-label={r.view(l.title)}
                  >
                    <Eye aria-hidden className="size-4" />
                    {r.viewShort}
                  </a>
                )}
                {editable && l.status === 'received' && l.documentId && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setRejecting(l)}
                      aria-label={r.rejectPaper(l.title)}
                    >
                      {r.reject}
                    </Button>
                    <Button
                      size="sm"
                      disabled={check.isPending}
                      onClick={() =>
                        l.documentId &&
                        check.mutate({ documentId: l.documentId, status: 'verified' })
                      }
                      aria-label={r.acceptPaper(l.title)}
                    >
                      <Check aria-hidden className="size-4" />
                      {r.accept}
                    </Button>
                  </>
                )}
                {editable && (l.status === 'missing' || l.status === 'rejected') && (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      setUpload(l);
                      fileInput.current?.click();
                    }}
                    aria-label={r.uploadPaper(l.title)}
                  >
                    <FileUp aria-hidden className="size-4" />
                    {r.upload}
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && upload) send.mutate({ line: upload, file: f });
          e.target.value = '';
        }}
      />
      {(check.error || send.error || verify.error) && (
        <p
          role="alert"
          className="rounded-md bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink"
        >
          {admissionError(check.error ?? send.error ?? verify.error)}
        </p>
      )}
      {editable && ['applied', 'documents_pending'].includes(a.state) && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onAsk} disabled={done === required.length}>
            <FileUp aria-hidden className="size-4" />
            {r.ask}
          </Button>
          <Button
            disabled={done !== required.length || verify.isPending}
            onClick={() => verify.mutate()}
          >
            <ShieldCheck aria-hidden className="size-4" />
            {r.verify}
          </Button>
        </div>
      )}
      {rejecting && (
        <ReasonDialog
          title={r.rejectTitle(rejecting.title)}
          hint={r.rejectHint}
          label={t.reason}
          action={r.reject}
          cancel={en.form.cancel}
          minLength={3}
          errorText={admissionError}
          onClose={() => setRejecting(null)}
          submit={async (note) => {
            if (rejecting.documentId)
              await check.mutateAsync({
                documentId: rejecting.documentId,
                status: 'rejected',
                note,
              });
          }}
        />
      )}
    </ProfilePanel>
  );
}

function describe(e: TimelineItem): { icon: LucideIcon; text: string; tone?: string } {
  const Icon = KIND_ICON[e.kind];
  switch (e.kind) {
    case 'state':
      return { icon: Sparkles, text: r.tl.state(t.states[e.title ?? ''] ?? e.title ?? '') };
    case 'follow_up':
      return {
        icon: CalendarClock,
        text: r.tl.followUp(e.title ?? '', e.detail ? shortDate(e.detail) : ''),
      };
    case 'follow_up_done':
      return {
        icon: CalendarCheck2,
        text: r.tl.followUpDone(e.title ?? ''),
        tone: 'text-signal-go-ink',
      };
    case 'form_sent':
      return {
        icon: Send,
        text: r.tl.formSent(c.send.channels[e.title ?? ''] ?? '', e.detail === 'papers'),
      };
    case 'form_opened':
      return { icon: Eye, text: r.tl.formOpened(e.detail === 'papers') };
    case 'form_submitted':
      return {
        icon: Check,
        text: r.tl.formSubmitted(e.detail === 'papers'),
        tone: 'text-signal-go-ink',
      };
    case 'paper_received':
      return { icon: FileUp, text: r.tl.paperReceived(e.title ?? '', e.outcome === 'family') };
    case 'paper_checked':
      return {
        icon: e.outcome === 'verified' ? FileCheck2 : FileX2,
        text: r.tl.paperChecked(e.title ?? '', e.outcome === 'verified'),
        tone: e.outcome === 'verified' ? 'text-signal-go-ink' : 'text-signal-stop-ink',
      };
    default:
      return {
        icon: Icon ?? NotebookPen,
        text: [c.kinds[e.kind] ?? e.kind, e.outcome && (c.outcomes[e.outcome] ?? e.outcome)]
          .filter(Boolean)
          .join(' · '),
      };
  }
}

function ActivityTab({ a, onLog }: { a: Rec; onLog: () => void }) {
  const byDay = new Map<string, TimelineItem[]>();
  for (const e of a.timeline) {
    const day = new Date(e.at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  return (
    <ProfilePanel
      title={r.timeline}
      icon={NotebookPen}
      description={r.timelineLead}
      action={
        <Button size="sm" onClick={onLog}>
          <Plus aria-hidden className="size-4" />
          {r.log}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {[...byDay.entries()].map(([day, items]) => (
          <section key={day} aria-label={relDay(day)}>
            <h3 className="mb-2 text-caption font-semibold tracking-[0.12em] text-ink-muted uppercase">
              {relDay(day)}
            </h3>
            <ol className="relative flex flex-col gap-3 border-l border-line pl-5">
              {items.map((e, i) => {
                const d = describe(e);
                const time = new Date(e.at).toLocaleTimeString('en-IN', {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: 'Asia/Kolkata',
                });
                return (
                  <li key={`${e.at}-${i}`} className="relative">
                    <span className="absolute top-0.5 -left-[31px] flex size-5 items-center justify-center rounded-full border border-line bg-surface">
                      <d.icon aria-hidden className={cx('size-3', d.tone ?? 'text-ink-muted')} />
                    </span>
                    <p className={cx('text-body font-medium', d.tone ?? 'text-ink')}>{d.text}</p>
                    {e.detail &&
                      !['follow_up', 'form_sent', 'form_opened', 'form_submitted'].includes(
                        e.kind,
                      ) && <p className="text-body text-ink-muted">{e.detail}</p>}
                    <p className="text-caption text-ink-muted">
                      {[time, e.by].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </ProfilePanel>
  );
}

function FeesTab({ a }: { a: Rec }) {
  return (
    <ProfilePanel title={t.fees} icon={IndianRupee} description={r.feesLead}>
      {a.fees.length === 0 ? (
        <p className="text-body text-signal-warn-ink">{t.noFees}</p>
      ) : (
        a.fees.map((f) => (
          <div
            key={f.planId}
            className="flex flex-col gap-2 rounded-xl border border-line p-4 text-body"
          >
            <span className="flex justify-between font-medium text-ink">
              {f.name}
              <span className="tabular">
                {rupees(f.totalPaise)} {t.perYear}
              </span>
            </span>
            <div className="flex flex-col gap-1 border-t border-line pt-2">
              {f.lines.map((l) => (
                <span key={l.head} className="flex justify-between text-caption text-ink-muted">
                  {l.head} <span className="tabular">{rupees(l.amountPaise)}</span>
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-1 border-t border-line pt-2">
              {f.instalments.map((i) => (
                <span key={i.label} className="flex justify-between text-caption text-ink-muted">
                  {i.label} · {shortDate(i.dueOn)}{' '}
                  <span className="tabular">{rupees(i.amountPaise)}</span>
                </span>
              ))}
            </div>
          </div>
        ))
      )}
    </ProfilePanel>
  );
}

/** Everything the family told the school, in one form; every field optional beyond the names. */
function EditDetails({
  a,
  onClose,
  onSaved,
}: {
  a: Rec;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [b, setB] = useState({
    childName: a.childName,
    dateOfBirth: a.dateOfBirth ?? '',
    gender: a.gender ?? '',
    guardianName: a.guardianName,
    guardianRelationship: a.guardianRelationship,
    guardianPhone: a.guardianPhone.slice(3),
  });
  const [d, setD] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(a.details).map(([k, v]) => [k, v ?? ''])),
  );
  const save = useMutation({
    mutationFn: () =>
      api.post(`/school/admissions/applications/${a.id}/update`, {
        childName: b.childName,
        dateOfBirth: b.dateOfBirth || null,
        gender: b.gender || null,
        guardianName: b.guardianName,
        guardianRelationship: b.guardianRelationship,
        guardianPhone: `+91${b.guardianPhone.replace(/\D/g, '').slice(-10)}`,
        details: Object.fromEntries(
          Object.entries(d).map(([k, v]) => [
            k,
            k === 'secondGuardianPhone' && v ? `+91${v.replace(/\D/g, '').slice(-10)}` : v || null,
          ]),
        ),
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const bad = new Set(
    save.error instanceof ApiFailure && save.error.code === 'bad_details'
      ? ((save.error.details as { fields?: string[] } | null)?.fields ?? [])
      : [],
  );
  const text = (
    k: string,
    label: string,
    opts: { type?: string; max?: number; wide?: boolean } = {},
  ) => (
    <ModalField label={label} hint={bad.has(k) ? r.checkThis : undefined} wide={opts.wide ?? false}>
      <input
        type={opts.type ?? 'text'}
        value={k === 'secondGuardianPhone' ? (d[k] ?? '').replace(/^\+91/, '') : (d[k] ?? '')}
        maxLength={opts.max}
        aria-invalid={bad.has(k) || undefined}
        onChange={(e) => setD({ ...d, [k]: e.target.value })}
        className={cx(field, bad.has(k) && 'border-signal-stop')}
      />
    </ModalField>
  );
  const pick = (k: string, label: string, options: Record<string, string>) => (
    <ModalField label={label}>
      <select
        value={d[k] ?? ''}
        onChange={(e) => setD({ ...d, [k]: e.target.value })}
        className={field}
      >
        <option value="">—</option>
        {Object.entries(options).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </ModalField>
  );
  const heading = (s: string) => (
    <p className="col-span-full -mb-1 pt-2 text-caption font-semibold tracking-[0.12em] text-ink-muted uppercase">
      {s}
    </p>
  );
  return (
    <FormModal
      title={r.editTitle(a.childName)}
      size="xl"
      submitLabel={r.save}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      error={save.error ? admissionError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {heading(t.child)}
      <ModalField label={t.childName}>
        <input
          required
          value={b.childName}
          onChange={(e) => setB({ ...b, childName: e.target.value })}
          className={field}
        />
      </ModalField>
      <ModalField label={t.dateOfBirth}>
        <input
          type="date"
          value={b.dateOfBirth}
          onChange={(e) => setB({ ...b, dateOfBirth: e.target.value })}
          className={field}
        />
      </ModalField>
      <ModalField label={c.gender}>
        <select
          value={b.gender}
          onChange={(e) => setB({ ...b, gender: e.target.value })}
          className={field}
        >
          <option value="">—</option>
          {Object.entries(c.genders).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </ModalField>
      {text('placeOfBirth', r.placeOfBirth, { max: 80 })}
      {heading(r.family)}
      <ModalField label={t.guardianName}>
        <input
          required
          value={b.guardianName}
          onChange={(e) => setB({ ...b, guardianName: e.target.value })}
          className={field}
        />
      </ModalField>
      <ModalField label={t.relationship}>
        <select
          value={b.guardianRelationship}
          onChange={(e) => setB({ ...b, guardianRelationship: e.target.value })}
          className={field}
        >
          {Object.entries(t.relationships).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.guardianPhone}>
        <input
          inputMode="tel"
          value={b.guardianPhone}
          onChange={(e) => setB({ ...b, guardianPhone: e.target.value })}
          className={field}
        />
      </ModalField>
      {text('guardianEmail', c.email, { type: 'email', max: 200 })}
      {heading(r.secondGuardian)}
      {text('secondGuardianName', r.name, { max: 120 })}
      {pick('secondGuardianRelationship', t.relationship, t.relationships)}
      {text('secondGuardianPhone', t.guardianPhone)}
      {text('secondGuardianEmail', c.email, { type: 'email', max: 200 })}
      {heading(r.home)}
      {text('addressLine', r.address, { max: 300, wide: true })}
      {text('city', r.city, { max: 80 })}
      {text('pincode', r.pincode, { max: 6 })}
      {pick('stateCode', r.state, STATES as Record<string, string>)}
      {text('previousSchool', r.previousSchool, { max: 160 })}
      {heading(r.background)}
      {text('motherTongue', r.motherTongue, { max: 40 })}
      {text('nationality', r.nationality, { max: 40 })}
      {pick(
        'bloodGroup',
        r.bloodGroup,
        Object.fromEntries(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => [g, g])),
      )}
      {text('religion', r.religion, { max: 40 })}
      {pick('socialCategory', r.socialCategory, r.categories)}
      {heading(r.health)}
      {text('disability', r.disability, { max: 200, wide: true })}
      <ModalField label={r.medicalNotes} wide>
        <textarea
          rows={2}
          maxLength={500}
          value={d.medicalNotes ?? ''}
          onChange={(e) => setD({ ...d, medicalNotes: e.target.value })}
          className={cx(field, 'h-auto py-2')}
        />
      </ModalField>
    </FormModal>
  );
}

function ScheduleFollowUp({
  a,
  onClose,
  onSaved,
}: {
  a: Rec;
  onClose: () => void;
  onSaved: () => void;
}) {
  const counsellors = useCounsellors(a.institutionId);
  const [f, setF] = useState({
    dueOn: plusDays(1),
    purpose: '',
    assignedTo: a.owner?.personId ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      api.post(`/school/admissions/applications/${a.id}/follow-ups`, {
        dueOn: f.dueOn,
        purpose: f.purpose,
        assignedTo: f.assignedTo || null,
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <FormModal
      title={r.scheduleTitle(a.childName)}
      submitLabel={r.schedule}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={f.purpose.trim().length < 2}
      error={save.error ? admissionError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={c.followUps.purpose} wide>
        <input
          value={f.purpose}
          maxLength={200}
          onChange={(e) => setF({ ...f, purpose: e.target.value })}
          className={field}
        />
      </ModalField>
      <ModalField label={c.followUps.due}>
        <input
          type="date"
          value={f.dueOn}
          onChange={(e) => setF({ ...f, dueOn: e.target.value })}
          className={field}
        />
      </ModalField>
      <ModalField label={r.assignTo}>
        <select
          value={f.assignedTo}
          onChange={(e) => setF({ ...f, assignedTo: e.target.value })}
          className={field}
        >
          <option value="">{r.me}</option>
          {(counsellors.data ?? []).map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.name}
            </option>
          ))}
        </select>
      </ModalField>
    </FormModal>
  );
}

function AskForPapers({ a, onClose }: { a: Rec; onClose: () => void }) {
  const [channel, setChannel] = useState<'whatsapp' | 'sms' | 'email' | 'link'>('whatsapp');
  const ask = useMutation({
    mutationFn: () =>
      api.post<SentInvite>(`/school/admissions/applications/${a.id}/request-papers`, { channel }),
  });
  if (ask.data) return <SentDialog sent={ask.data} title={r.askReady} onClose={onClose} />;
  const needed = a.checklist.filter(
    (l) => l.required && l.status !== 'verified' && l.status !== 'received',
  );
  return (
    <FormModal
      title={r.askTitle(a.childName)}
      description={r.askLead}
      submitLabel={r.askCreate}
      cancelLabel={en.form.cancel}
      pending={ask.isPending}
      error={ask.error ? admissionError(ask.error) : null}
      onClose={onClose}
      onSubmit={() => ask.mutate()}
    >
      <ul className="col-span-full flex flex-col gap-1.5 rounded-xl bg-paper p-3">
        {needed.map((l) => (
          <li key={l.kind} className="flex items-start gap-2 text-body text-ink">
            <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
            <span>
              {l.title}
              {l.status === 'rejected' && l.note && (
                <span className="text-ink-muted"> · {l.note}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <ModalField label={c.send.how} wide>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as typeof channel)}
          className={field}
        >
          {(['whatsapp', 'sms', 'email', 'link'] as const)
            .filter((k) => k !== 'email' || a.details.guardianEmail)
            .map((k) => (
              <option key={k} value={k}>
                {c.send.channels[k]}
              </option>
            ))}
        </select>
      </ModalField>
      <p className="col-span-full text-caption text-ink-muted">{r.askNote}</p>
    </FormModal>
  );
}

function AgeOverride({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [orderRef, setOrderRef] = useState('');
  return (
    <ReasonDialog
      title={t.overrideTitle}
      hint={t.overrideHint}
      label={t.overrideReason}
      action={t.overrideAction}
      cancel={en.form.cancel}
      minLength={3}
      errorText={admissionError}
      onClose={onClose}
      submit={async (reason) => {
        await api.post(`/school/admissions/applications/${id}/update`, {
          ageOverride: { reason, orderRef },
        });
        onSaved();
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.orderRef}</span>
        <input
          required
          value={orderRef}
          onChange={(e) => setOrderRef(e.target.value)}
          className={field}
        />
      </label>
    </ReasonDialog>
  );
}
