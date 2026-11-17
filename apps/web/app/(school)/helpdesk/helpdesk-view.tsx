'use client';

// The helpdesk (docs/specs/HELPDESK.md): queues with overdue first, a request's thread in a side
// panel (reply, internal note, assign, state), the person's own requests, and categories.
import type {
  Category,
  HelpdeskFigures,
  TicketMessage,
  TicketRow,
} from '@campusverse/shared-helpdesk';
import {
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  RecordDrawer,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Headset, Plus, Inbox, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';

const t = en.helpdesk;
type View = 'open' | 'mine' | 'overdue' | 'waiting' | 'resolved' | 'raised' | 'categories';
type Detail = TicketRow & { messages: TicketMessage[]; canWork: boolean };

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

function QueryState({ q }: { q: { isPending: boolean; error: unknown } }) {
  if (q.isPending) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  if (q.error instanceof ApiFailure && q.error.status === 403)
    return <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />;
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return (
      <StatePanel kind="offline" title={en.states.offline.title} body={en.states.offline.body} />
    );
  return <StatePanel kind="error" title={en.states.error.title} />;
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of [
      'helpdesk-figures',
      'helpdesk-tickets',
      'helpdesk-ticket',
      'helpdesk-categories',
    ])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

export function HelpdeskView() {
  const school = useInstitution();
  const { can } = useMe();
  const handle = can('helpdesk.ticket.handle');
  const setup = can('helpdesk.setup.manage');
  const id = school.institutionId;
  const [view, setView] = useState<View>('open');
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const views: View[] = [
    ...(handle ? (['open', 'overdue', 'waiting'] as const) : []),
    'mine',
    ...(handle ? (['resolved'] as const) : []),
    'raised',
    ...(setup ? (['categories'] as const) : []),
  ];
  const current = views.includes(view) ? view : (views[0] ?? 'mine');
  const figures = useQuery({
    queryKey: ['helpdesk-figures', id],
    queryFn: () => api.get<HelpdeskFigures>(`/helpdesk/figures?institutionId=${id}`),
    enabled: !!id && handle,
  });
  const list = useQuery({
    queryKey: ['helpdesk-tickets', id, current],
    queryFn: () => api.get<TicketRow[]>(`/helpdesk/tickets?institutionId=${id}&view=${current}`),
    enabled: !!id && current !== 'categories',
  });
  const f = figures.data;
  const refresh = useRefresh();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Headset}
        art="welcome"
        area="amber"
        eyebrow={en.nav.groups.services}
        title={t.title}
        description={t.lead}
        actions={
          <Button onClick={() => setAsking(true)}>
            <Plus aria-hidden className="size-4" />
            {t.newRequest}
          </Button>
        }
      />
      {f && (
        <KeyFigures
          label={t.figures}
          figures={[
            { label: t.fig.open, icon: Inbox, value: String(f.open) },
            {
              label: t.fig.overdue,
              icon: AlertTriangle,
              value: String(f.overdue),
              ...(f.overdue ? { tone: 'warn' as const } : {}),
            },
            { label: t.fig.waiting, icon: Clock, value: String(f.waiting) },
            { label: t.fig.resolved, icon: CheckCircle2, value: String(f.resolvedWeek) },
          ]}
        />
      )}
      <Segmented
        label={t.tabsLabel}
        value={current}
        onChange={setView}
        options={views.map((v) => ({ value: v, label: t.views[v] ?? v }))}
      />
      {!id ? (
        <QueryState q={{ isPending: true, error: null }} />
      ) : current === 'categories' ? (
        <Categories institutionId={id} />
      ) : !list.data ? (
        <QueryState q={list} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={Headset} area="amber" title={t.empty[current] ?? ''} />
      ) : (
        <Section id="helpdesk-list" title={t.views[current] ?? t.title} flush>
          <ul className="divide-y divide-line">
            {list.data.map((r) => (
              <li key={r.ticketId}>
                <button
                  type="button"
                  onClick={() => setOpen(r.ticketId)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-paper"
                >
                  <span className="text-caption font-semibold text-ink-muted tabular-nums">
                    #{r.number}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body text-ink">{r.subject}</span>
                    <span className="text-caption text-ink-muted">
                      {[
                        r.category,
                        r.raisedBy ? t.raisedBy(r.raisedBy) : null,
                        r.student
                          ? t.about(`${r.student}${r.studentLabel ? `, ${r.studentLabel}` : ''}`)
                          : null,
                        r.assignee ? t.assignedTo(r.assignee) : t.unassigned,
                        r.state !== 'resolved' ? t.due(when(r.dueAt)) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {r.priority === 'urgent' && <Pill tone="warn">{t.urgent}</Pill>}
                  <Pill tone={r.overdue ? 'stop' : r.state === 'resolved' ? 'go' : 'neutral'}>
                    {r.overdue ? t.overdue : t.state[r.state]}
                  </Pill>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {open && (
        <TicketDrawer ticketId={open} institutionId={id ?? ''} onClose={() => setOpen(null)} />
      )}
      {asking && id && (
        <RaiseForm
          institutionId={id}
          onClose={() => setAsking(false)}
          onDone={() => {
            setAsking(false);
            setView('raised');
            refresh();
          }}
        />
      )}
    </div>
  );
}

function TicketDrawer({
  ticketId,
  institutionId,
  onClose,
}: {
  ticketId: string;
  institutionId: string;
  onClose: () => void;
}) {
  const { can } = useMe();
  const refresh = useRefresh();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [next, setNext] = useState('');
  const q = useQuery({
    queryKey: ['helpdesk-ticket', ticketId],
    queryFn: () => api.get<Detail>(`/helpdesk/tickets/${ticketId}`),
  });
  const staff = useQuery({
    queryKey: ['helpdesk-staff', institutionId],
    queryFn: () =>
      api.get<{ personId: string; name: string }[]>(`/people/staff?institutionId=${institutionId}`),
    enabled: can('helpdesk.ticket.handle') && can('people.staff.read'),
    retry: false,
  });
  const reply = useMutation({
    mutationFn: () =>
      api.post(`/helpdesk/tickets/${ticketId}/reply`, { body, internal, state: next || null }),
    onSuccess: () => {
      setBody('');
      setInternal(false);
      setNext('');
      refresh();
    },
  });
  const assign = useMutation({
    mutationFn: (personId: string) =>
      api.post(`/helpdesk/tickets/${ticketId}/assign`, { personId: personId || null }),
    onSuccess: refresh,
  });
  const d = q.data;
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={d ? `#${d.number} ${d.subject}` : t.title}
      {...(d ? { subtitle: `${d.category} · ${d.overdue ? t.overdue : t.state[d.state]}` } : {})}
      closeLabel={t.close}
    >
      {!d ? (
        <QueryState q={q} />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-caption text-ink-muted">
            {[
              d.raisedBy ? t.raisedBy(d.raisedBy) : null,
              d.student
                ? t.about(`${d.student}${d.studentLabel ? `, ${d.studentLabel}` : ''}`)
                : null,
              d.state !== 'resolved' ? t.due(when(d.dueAt)) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {d.canWork && staff.data && (
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.assign}</span>
              <select
                className={fieldInput}
                value={d.assigneeId ?? ''}
                disabled={assign.isPending}
                onChange={(e) => assign.mutate(e.target.value)}
              >
                <option value="">{t.nobody}</option>
                {staff.data.map((s) => (
                  <option key={s.personId} value={s.personId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <section aria-label={t.thread} className="flex flex-col gap-3">
            {d.messages.map((m) => (
              <div
                key={m.messageId}
                className={cx(
                  'rounded-xl border px-3 py-2',
                  m.internal ? 'border-signal-warn bg-signal-warn-tint' : 'border-line bg-surface',
                )}
              >
                <p className="text-caption text-ink-muted">
                  {m.author ?? ''} · {when(m.at)}
                  {m.internal ? ` · ${t.internalNote}` : ''}
                </p>
                <p className="text-body whitespace-pre-line text-ink">{m.body}</p>
              </div>
            ))}
          </section>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) reply.mutate();
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.reply}</span>
              <textarea
                className={cx(fieldInput, 'h-auto py-2')}
                rows={4}
                maxLength={4000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            {d.canWork && (
              <>
                <label className="flex items-start gap-2 text-body text-ink">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={internal}
                    onChange={(e) => setInternal(e.target.checked)}
                  />
                  <span>
                    {t.internalNote}
                    <span className="block text-caption text-ink-muted">{t.internalHint}</span>
                  </span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-caption font-medium text-ink">{t.sendAs}</span>
                  <select
                    className={fieldInput}
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                  >
                    <option value="">{t.keepState}</option>
                    {(['in_progress', 'waiting', 'resolved'] as const).map((s) => (
                      <option key={s} value={s}>
                        {t.state[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {reply.isError && (
              <p role="alert" className="text-caption text-signal-stop-ink">
                {errorText(reply.error)}
              </p>
            )}
            <Button type="submit" className="self-start" disabled={!body.trim() || reply.isPending}>
              {t.send}
            </Button>
          </form>
        </div>
      )}
    </RecordDrawer>
  );
}

function RaiseForm({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const cats = useQuery({
    queryKey: ['helpdesk-categories'],
    queryFn: () => api.get<Category[]>('/helpdesk/categories'),
  });
  const [categoryId, setCategoryId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('normal');
  const save = useMutation({
    mutationFn: () =>
      api.post('/helpdesk/tickets', { institutionId, categoryId, subject, body, priority }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.newTitle}
      submitLabel={t.send}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!categoryId || !subject.trim() || !body.trim()}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.category}>
        <select
          className={fieldInput}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="" />
          {(cats.data ?? [])
            .filter((c) => c.active && c.audience !== 'parents')
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </ModalField>
      <ModalField label={t.priority}>
        <select
          className={fieldInput}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          {(['normal', 'urgent'] as const).map((p) => (
            <option key={p} value={p}>
              {t.priorities[p]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.subject} wide>
        <input
          className={fieldInput}
          value={subject}
          maxLength={160}
          onChange={(e) => setSubject(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.details} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={5}
          maxLength={4000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function Categories({ institutionId }: { institutionId: string }) {
  const refresh = useRefresh();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['helpdesk-categories'],
    queryFn: () => api.get<Category[]>('/helpdesk/categories'),
  });
  return (
    <Section
      id="helpdesk-categories"
      title={t.views.categories ?? t.title}
      flush
      actions={
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden className="size-4" />
          {t.addCategory}
        </Button>
      }
    >
      {!q.data ? (
        <div className="p-5">
          <QueryState q={q} />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-body text-ink">
                  {c.name}
                  {!c.active && <Pill>{t.off}</Pill>}
                </span>
                <span className="text-caption text-ink-muted">
                  {[
                    t.hoursLine(c.hours),
                    t.audiences[c.audience],
                    c.assignee ? t.assignedTo(c.assignee) : t.unassigned,
                  ].join(' · ')}
                </span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                {t.edit}
                <span className="sr-only"> {c.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <CategoryForm
          institutionId={institutionId}
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </Section>
  );
}

function CategoryForm({
  institutionId,
  category,
  onClose,
  onDone,
}: {
  institutionId: string;
  category: Category | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { can } = useMe();
  const [name, setName] = useState(category?.name ?? '');
  const [hours, setHours] = useState(String(category?.hours ?? 24));
  const [assignee, setAssignee] = useState(category?.assigneePersonId ?? '');
  const [audience, setAudience] = useState(category?.audience ?? 'both');
  const [active, setActive] = useState(category?.active ?? true);
  const staff = useQuery({
    queryKey: ['helpdesk-staff', institutionId],
    queryFn: () =>
      api.get<{ personId: string; name: string }[]>(`/people/staff?institutionId=${institutionId}`),
    enabled: can('people.staff.read'),
    retry: false,
  });
  const h = Number(hours);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        institutionId,
        name,
        hours: h,
        assigneePersonId: assignee || null,
        audience,
        active,
      };
      return category
        ? api.put(`/helpdesk/categories/${category.id}`, body)
        : api.post('/helpdesk/categories', body);
    },
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={category ? t.editCategory : t.addCategory}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!name.trim() || !(Number.isInteger(h) && h >= 1 && h <= 720)}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.name}>
        <input
          className={fieldInput}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.hours}>
        <input
          className={fieldInput}
          inputMode="numeric"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.audience}>
        <select
          className={fieldInput}
          value={audience}
          onChange={(e) => setAudience(e.target.value as Category['audience'])}
        >
          {(['both', 'parents', 'staff'] as const).map((a) => (
            <option key={a} value={a}>
              {t.audiences[a]}
            </option>
          ))}
        </select>
      </ModalField>
      {staff.data && (
        <ModalField label={t.defaultAssignee}>
          <select
            className={fieldInput}
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">{t.nobody}</option>
            {staff.data.map((s) => (
              <option key={s.personId} value={s.personId}>
                {s.name}
              </option>
            ))}
          </select>
        </ModalField>
      )}
      {category && (
        <label className="flex items-center gap-2 text-body text-ink sm:col-span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t.active}
        </label>
      )}
    </FormModal>
  );
}
