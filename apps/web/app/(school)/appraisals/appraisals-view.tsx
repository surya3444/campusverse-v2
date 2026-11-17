'use client';

// Appraisals (docs/specs/APPRAISALS.md): my appraisal (self-rating, then the result and
// acknowledgement), reviews I give, and cycles for managers (criteria, opening with a preview,
// reviewers, progress, closing).
import type { CycleRow, ReviewDetail, ReviewRow } from '@campusverse/people-appraisals';
import {
  Button,
  EmptyState,
  FormModal,
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
import { Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInline, fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { useUrlTab } from '../common/url-tab';

const t = en.appraisals;
type Tab = 'mine' | 'review' | 'cycles';

const dmy = (d: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

function QueryState({ q }: { q: { isPending: boolean; error: unknown } }) {
  if (q.isPending) return <SkeletonRows rows={4} label={en.states.loading.title} />;
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
    for (const k of ['appraisals-mine', 'appraisal', 'appraisal-cycles', 'appraisal-reviews'])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

export function AppraisalsView() {
  const school = useInstitution();
  const { can } = useMe();
  const manage = can('people.appraisal.manage');
  const [tab, setTab] = useUrlTab<Tab>(['mine', 'review', 'cycles'], 'mine');
  const [open, setOpen] = useState<string | null>(null);
  const mine = useQuery({
    queryKey: ['appraisals-mine', school.institutionId],
    queryFn: () =>
      api.get<{ mine: ReviewRow[]; toReview: ReviewRow[] }>(
        `/appraisals/mine?institutionId=${school.institutionId}`,
      ),
    enabled: !!school.institutionId,
  });
  const tabs: Tab[] = ['mine', 'review', ...(manage ? (['cycles'] as const) : [])];
  const list = (rows: ReviewRow[], forReviewer: boolean) =>
    rows.length === 0 ? (
      <EmptyState
        icon={Star}
        area="sky"
        title={forReviewer ? t.noReview : t.noMine}
        {...(forReviewer ? {} : { body: t.noMineBody })}
      />
    ) : (
      <Section
        id={forReviewer ? 'appraisal-to-review' : 'appraisal-mine'}
        title={forReviewer ? t.tabs.review : t.tabs.mine}
        flush
      >
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.reviewId}>
              <button
                type="button"
                onClick={() => setOpen(r.reviewId)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-paper"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink">{forReviewer ? r.person : r.cycle}</span>
                  <span className="text-caption text-ink-muted">
                    {[
                      forReviewer ? r.cycle : r.reviewer ? t.reviewer(r.reviewer) : null,
                      r.cycleState === 'open' ? t.closes(dmy(r.closesOn)) : t.closed,
                      r.score ? t.score(r.score) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Pill
                  tone={
                    (forReviewer ? r.state === 'review' : r.state === 'self' || r.state === 'done')
                      ? 'warn'
                      : r.state === 'acknowledged'
                        ? 'go'
                        : 'neutral'
                  }
                >
                  {(forReviewer ? t.reviewerState : t.state)[r.state]}
                </Pill>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Star}
        art="students"
        area="sky"
        eyebrow={en.nav.groups.people}
        title={t.title}
        description={t.lead}
        actions={
          <Segmented
            label={t.tabsLabel}
            value={tab}
            onChange={setTab}
            options={tabs.map((v) => ({ value: v, label: t.tabs[v] }))}
          />
        }
      />
      {tab === 'cycles' && school.institutionId ? (
        <Cycles institutionId={school.institutionId} />
      ) : !mine.data ? (
        <QueryState q={mine} />
      ) : tab === 'mine' ? (
        list(mine.data.mine, false)
      ) : (
        list(mine.data.toReview, true)
      )}
      {open && <ReviewDrawer reviewId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One review
// ---------------------------------------------------------------------------------------------

function RatingRow({
  title,
  weight,
  value,
  onChange,
  disabled,
}: {
  title: string;
  weight: number;
  value: number | undefined;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-body text-ink">
        {title}
        {weight > 1 && (
          <span className="ml-2 text-caption text-ink-muted">{t.weightOf(weight)}</span>
        )}
      </legend>
      <div role="radiogroup" aria-label={t.rating(title)} className="flex flex-wrap gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className={cx(
              'inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-caption',
              value === n
                ? 'border-navy-950 bg-navy-50 text-navy-950'
                : 'border-line-strong text-ink',
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={`rate-${title}`}
              checked={value === n}
              disabled={disabled}
              onChange={() => onChange(n)}
            />
            {t.scale[n - 1]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ReviewDrawer({ reviewId, onClose }: { reviewId: string; onClose: () => void }) {
  const refresh = useRefresh();
  const q = useQuery({
    queryKey: ['appraisal', reviewId],
    queryFn: () => api.get<ReviewDetail>(`/appraisals/reviews/${reviewId}`),
  });
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [reply, setReply] = useState('');
  const d = q.data;
  const selfTurn = d?.you === 'person' && d.state === 'self' && d.cycleState === 'open';
  const reviewTurn = d?.you === 'reviewer' && d.state === 'review' && d.cycleState === 'open';
  const ackTurn = d?.you === 'person' && d.state === 'done';
  const submit = useMutation({
    mutationFn: () =>
      api.post(`/appraisals/reviews/${reviewId}/${selfTurn ? 'self' : 'review'}`, {
        ratings: Object.entries(ratings).map(([criterionId, score]) => ({
          criterionId,
          score,
          comment: '',
        })),
        comment,
      }),
    onSuccess: () => {
      setRatings({});
      setComment('');
      refresh();
    },
  });
  const ack = useMutation({
    mutationFn: () => api.post(`/appraisals/reviews/${reviewId}/acknowledge`, { reply }),
    onSuccess: refresh,
  });
  const scoreOf = (list: ReviewDetail['self'], id: string) =>
    list.find((x) => x.criterionId === id)?.score;
  const allRated = !!d && d.criteria.every((c) => ratings[c.criterionId]);
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={d ? (d.you === 'person' ? d.cycle : `${d.person ?? ''} · ${d.cycle}`) : t.title}
      {...(d
        ? {
            subtitle: `${(d.you === 'reviewer' ? t.reviewerState : t.state)[d.state]}${d.score ? ` · ${t.score(d.score)}` : ''}`,
          }
        : {})}
      closeLabel={t.shut}
    >
      {!d ? (
        <QueryState q={q} />
      ) : (
        <div className="flex flex-col gap-5">
          {selfTurn || reviewTurn ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit.mutate();
              }}
            >
              {d.criteria.map((c) => (
                <div key={c.criterionId} className="flex flex-col gap-1">
                  <RatingRow
                    title={c.title}
                    weight={c.weight}
                    value={ratings[c.criterionId]}
                    onChange={(n) => setRatings((cur) => ({ ...cur, [c.criterionId]: n }))}
                  />
                  {reviewTurn && scoreOf(d.self, c.criterionId) && (
                    <span className="text-caption text-ink-muted">
                      {`${d.person ?? ''}: ${t.scale[(scoreOf(d.self, c.criterionId) ?? 1) - 1]}`}
                    </span>
                  )}
                </div>
              ))}
              {reviewTurn && d.selfComment && (
                <p className="text-caption text-ink-muted">
                  {d.person}: “{d.selfComment}”
                </p>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-ink">{t.comment}</span>
                <textarea
                  className={cx(fieldInput, 'h-auto py-2')}
                  rows={4}
                  maxLength={2000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <span className="text-caption text-ink-muted">
                  {reviewTurn ? t.reviewerCommentHint : t.commentOptional}
                </span>
              </label>
              {submit.isError && (
                <p role="alert" className="text-caption text-signal-stop-ink">
                  {errorText(submit.error)}
                </p>
              )}
              <Button
                type="submit"
                className="self-start"
                disabled={
                  !allRated || submit.isPending || (reviewTurn && comment.trim().length < 3)
                }
              >
                {selfTurn ? t.submitSelf : t.submitReview}
              </Button>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {d.criteria.map((c) => {
                  const mine = scoreOf(d.self, c.criterionId);
                  const theirs = scoreOf(d.reviewerRatings, c.criterionId);
                  return (
                    <li
                      key={c.criterionId}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 text-body text-ink">{c.title}</span>
                      {mine && (
                        <span className="text-caption text-ink-muted tabular-nums">
                          {t.yourRating}: {mine}
                        </span>
                      )}
                      {theirs && (
                        <span className="text-caption font-medium text-ink tabular-nums">
                          {t.theirRating}: {theirs}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {d.selfComment && (
                <p className="text-body text-ink">
                  <span className="text-caption text-ink-muted">{t.youSaid}: </span>
                  {d.selfComment}
                </p>
              )}
              {d.reviewerComment && (
                <p className="text-body text-ink">
                  <span className="text-caption text-ink-muted">{t.theySaid}: </span>
                  {d.reviewerComment}
                </p>
              )}
              {d.reply && <p className="text-caption text-ink-muted">{t.replied(d.reply)}</p>}
            </div>
          )}
          {ackTurn && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                ack.mutate();
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-ink">{t.reply}</span>
                <input
                  className={fieldInput}
                  value={reply}
                  maxLength={1000}
                  onChange={(e) => setReply(e.target.value)}
                />
                <span className="text-caption text-ink-muted">{t.commentOptional}</span>
              </label>
              {ack.isError && (
                <p role="alert" className="text-caption text-signal-stop-ink">
                  {errorText(ack.error)}
                </p>
              )}
              <Button type="submit" className="self-start" disabled={ack.isPending}>
                {t.acknowledge}
              </Button>
            </form>
          )}
        </div>
      )}
    </RecordDrawer>
  );
}

// ---------------------------------------------------------------------------------------------
// Cycles (managers)
// ---------------------------------------------------------------------------------------------

function Cycles({ institutionId }: { institutionId: string }) {
  const refresh = useRefresh();
  const { can } = useMe();
  const [editing, setEditing] = useState<CycleRow | 'new' | null>(null);
  const [opening, setOpening] = useState<CycleRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['appraisal-cycles', institutionId],
    queryFn: () => api.get<CycleRow[]>(`/appraisals/cycles?institutionId=${institutionId}`),
  });
  const reviews = useQuery({
    queryKey: ['appraisal-reviews', expanded],
    queryFn: () =>
      api.get<ReviewRow[]>(`/appraisals/cycles/${expanded}/reviews?institutionId=${institutionId}`),
    enabled: !!expanded,
  });
  const staff = useQuery({
    queryKey: ['appraisal-staff', institutionId],
    queryFn: () =>
      api.get<{ personId: string; name: string }[]>(`/people/staff?institutionId=${institutionId}`),
    enabled: !!expanded && can('people.staff.read'),
    retry: false,
  });
  const act = useMutation({
    mutationFn: (a: { path: string; body: Record<string, unknown> }) =>
      api.post(a.path, { institutionId, ...a.body }),
    onSuccess: refresh,
  });
  return (
    <Section
      id="appraisal-cycles"
      title={t.tabs.cycles}
      flush
      actions={
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden className="size-4" />
          {t.newCycle}
        </Button>
      }
    >
      {act.isError && (
        <p role="alert" className="px-5 pt-3 text-caption text-signal-stop-ink">
          {errorText(act.error)}
        </p>
      )}
      {!q.data ? (
        <div className="p-5">
          <QueryState q={q} />
        </div>
      ) : q.data.length === 0 ? (
        <EmptyState compact icon={Star} title={t.noCycles} body={t.noCyclesBody} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((c) => (
            <li key={c.cycleId} className="flex flex-col gap-3 px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col text-left"
                  aria-expanded={expanded === c.cycleId}
                  onClick={() => setExpanded(expanded === c.cycleId ? null : c.cycleId)}
                >
                  <span className="flex items-center gap-2 text-body text-ink">
                    {c.name}
                    <Pill tone={c.state === 'open' ? 'go' : 'neutral'}>
                      {t.cycleState[c.state]}
                    </Pill>
                  </span>
                  <span className="text-caption text-ink-muted">
                    {dmy(c.opensOn)} – {dmy(c.closesOn)} · {c.criteria.length}{' '}
                    {t.criteria.toLowerCase()}
                    {c.state !== 'draft' ? ` · ${t.progress(c.counts)}` : ''}
                  </span>
                </button>
                {c.state === 'draft' && (
                  <span className="flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                      {t.editCycle}
                    </Button>
                    <Button size="sm" onClick={() => setOpening(c)}>
                      {t.open}
                    </Button>
                  </span>
                )}
                {c.state === 'open' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={act.isPending}
                    onClick={() =>
                      act.mutate({ path: `/appraisals/cycles/${c.cycleId}/close`, body: {} })
                    }
                  >
                    {t.close}
                  </Button>
                )}
              </div>
              {expanded === c.cycleId && reviews.data && (
                <ul
                  aria-label={t.reviews}
                  className="flex flex-col divide-y divide-line rounded-lg border border-line"
                >
                  {reviews.data.map((r) => (
                    <li
                      key={r.reviewId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 text-body text-ink">{r.person}</span>
                      <span className="text-caption text-ink-muted">{t.state[r.state]}</span>
                      {r.score && (
                        <span className="text-caption font-medium text-ink tabular-nums">
                          {r.score}
                        </span>
                      )}
                      {staff.data &&
                      (r.state === 'self' || r.state === 'review') &&
                      c.state === 'open' ? (
                        <select
                          aria-label={`${t.changeReviewer}: ${r.person ?? ''}`}
                          className={fieldInline}
                          value={r.reviewerId}
                          onChange={(e) =>
                            act.mutate({
                              path: `/appraisals/reviews/${r.reviewId}/reviewer`,
                              body: { personId: e.target.value },
                            })
                          }
                        >
                          {!staff.data.some((s) => s.personId === r.reviewerId) && (
                            <option value={r.reviewerId}>{r.reviewer}</option>
                          )}
                          {staff.data
                            .filter((s) => s.personId !== r.personId)
                            .map((s) => (
                              <option key={s.personId} value={s.personId}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <span className="text-caption text-ink-muted">{r.reviewer}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <CycleForm
          institutionId={institutionId}
          cycle={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {opening && (
        <OpenForm
          institutionId={institutionId}
          cycle={opening}
          onClose={() => setOpening(null)}
          onDone={() => {
            setOpening(null);
            refresh();
          }}
        />
      )}
    </Section>
  );
}

const DEFAULTS = [
  'Subject knowledge and teaching',
  'Classroom management',
  'Student progress',
  'Punctuality and attendance',
  'Teamwork and conduct',
  'Communication with parents',
];

function CycleForm({
  institutionId,
  cycle,
  onClose,
  onDone,
}: {
  institutionId: string;
  cycle: CycleRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(cycle?.name ?? '');
  const [opensOn, setOpensOn] = useState(cycle?.opensOn ?? todayIso());
  const [closesOn, setClosesOn] = useState(cycle?.closesOn ?? '');
  const [criteria, setCriteria] = useState(
    cycle?.criteria.map((c) => ({ title: c.title, weight: c.weight })) ??
      DEFAULTS.map((title) => ({ title, weight: 1 })),
  );
  const save = useMutation({
    mutationFn: () => {
      const body = {
        institutionId,
        name,
        opensOn,
        closesOn,
        criteria: criteria.filter((c) => c.title.trim()).map((c) => ({ ...c, description: '' })),
      };
      return cycle
        ? api.put(`/appraisals/cycles/${cycle.cycleId}`, body)
        : api.post('/appraisals/cycles', body);
    },
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={cycle ? t.editCycle : t.newCycle}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={
        !name.trim() ||
        !opensOn ||
        !closesOn ||
        closesOn < opensOn ||
        !criteria.some((c) => c.title.trim())
      }
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.name} wide>
        <input
          className={fieldInput}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.opensOn}>
        <input
          type="date"
          className={fieldInput}
          value={opensOn}
          onChange={(e) => setOpensOn(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.closesOn}>
        <input
          type="date"
          className={fieldInput}
          value={closesOn}
          min={opensOn}
          onChange={(e) => setClosesOn(e.target.value)}
        />
      </ModalField>
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="mb-1 text-caption font-medium text-ink">{t.criteria}</legend>
        {criteria.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label={`${t.criteria} ${i + 1}`}
              className={cx(fieldInput, 'flex-1')}
              value={c.title}
              maxLength={120}
              onChange={(e) =>
                setCriteria((cur) =>
                  cur.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                )
              }
            />
            <select
              aria-label={`${t.weight} ${i + 1}`}
              className={fieldInline}
              value={c.weight}
              onChange={(e) =>
                setCriteria((cur) =>
                  cur.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)),
                )
              }
            >
              {[1, 2, 3, 4, 5].map((w) => (
                <option key={w} value={w}>
                  {t.weightOf(w)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              type="button"
              disabled={criteria.length === 1}
              onClick={() => setCriteria((cur) => cur.filter((_, j) => j !== i))}
            >
              {t.removeCriterion}
              <span className="sr-only"> {c.title}</span>
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          type="button"
          className="self-start"
          onClick={() => setCriteria((cur) => [...cur, { title: '', weight: 1 }])}
        >
          {t.addCriterion}
        </Button>
      </fieldset>
    </FormModal>
  );
}

function OpenForm({
  institutionId,
  cycle,
  onClose,
  onDone,
}: {
  institutionId: string;
  cycle: CycleRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const preview = useQuery({
    queryKey: ['appraisal-open', cycle.cycleId],
    queryFn: () =>
      api.get<{ staff: number; names: string[] }>(
        `/appraisals/cycles/${cycle.cycleId}/open?institutionId=${institutionId}`,
      ),
  });
  const open = useMutation({
    mutationFn: () => api.post(`/appraisals/cycles/${cycle.cycleId}/open`, { institutionId }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.openTitle(cycle.name)}
      submitLabel={t.open}
      cancelLabel={t.cancel}
      pending={open.isPending}
      submitDisabled={!preview.data?.staff}
      error={open.error ? errorText(open.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => open.mutate()}
    >
      <div className="sm:col-span-2">
        {!preview.data ? (
          <QueryState q={preview} />
        ) : (
          <>
            <p className="text-body text-ink">{t.openLine(preview.data.staff)}</p>
            <p className="mt-2 text-caption text-ink-muted">{preview.data.names.join(', ')}</p>
          </>
        )}
      </div>
    </FormModal>
  );
}
