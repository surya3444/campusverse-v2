'use client';

// Enrollment › Merit & Seat Allocation for schools (rule book §13.1, §16.2): seat draws for a
// class and category, from a recorded seed anyone can check, published by a second person.
import type { DrawDetail, DrawRow, Pipeline } from '@campusverse/school-admissions';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  ModalField,
  PageHeader,
  Pill,
  RecordDrawer,
  Section,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleAlert, ListOrdered, Plus } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { fieldInput } from '../../common/custom-fields';
import { useMe } from '../../common/me';
import { YearPicker, useYear } from '../shared';

const t = en.draws;
const a = en.admissions;
type Category = 'general' | 'rte' | 'staff' | 'management';
const CATEGORIES: Category[] = ['general', 'rte', 'staff', 'management'];
const errorText = (e: unknown) =>
  (e instanceof ApiFailure ? (t.errors[e.code] ?? a.errors[e.code]) : undefined) ??
  t.errors.error ??
  '';
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
const tone = (s: DrawRow['state']) =>
  s === 'published' ? ('go' as const) : s === 'drawn' ? ('warn' as const) : ('neutral' as const);

export function DrawsView() {
  const school = useInstitution();
  const { can } = useMe();
  const id = school.institutionId ?? null;
  const [year, setYear] = useYear();
  const [drawing, setDrawing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['admission-draws', id, year],
    queryFn: () => api.get<DrawRow[]>(`/school/admissions/${id}/draws?year=${year}`),
    enabled: !!id,
  });
  const allowed = can('school.admission.manage');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ListOrdered}
        area="rose"
        eyebrow={en.systems.groups.enrollment}
        title={t.title}
        description={t.lead}
        actions={
          allowed ? (
            <Button onClick={() => setDrawing(true)} disabled={!id}>
              <Plus aria-hidden />
              {t.newDraw}
            </Button>
          ) : undefined
        }
      >
        <YearPicker year={year} onChange={setYear} />
      </PageHeader>
      <Announcer message={note} />
      {!allowed ? (
        <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
      ) : list.error ? (
        <StatePanel kind="error" title={errorText(list.error)} />
      ) : !list.data ? (
        <SkeletonRows label={t.title} />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          area="rose"
          title={t.none}
          body={t.noneBody}
          actions={
            <Button onClick={() => setDrawing(true)}>
              <Plus aria-hidden />
              {t.newDraw}
            </Button>
          }
        />
      ) : (
        <Section id="seat-draws" title={t.title} flush>
          <ul className="divide-y divide-line">
            {list.data.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setOpen(d.id)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-paper focus-visible:outline-2 focus-visible:outline-navy-950"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">
                      {d.className} · {a.categories[d.category]}
                    </span>
                    <span className="text-caption text-ink-muted">
                      {[
                        t.methods[d.method],
                        t.row(d.entered, d.seatsFree),
                        t.drawnBy(d.drawnBy, when(d.drawnAt)),
                      ].join(' · ')}
                    </span>
                  </span>
                  <Pill tone={tone(d.state)}>{t.states[d.state]}</Pill>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {drawing && id && (
        <DrawForm
          institutionId={id}
          year={year}
          onClose={() => setDrawing(false)}
          onDone={(drawId) => {
            setDrawing(false);
            setNote(t.form.drawn);
            setOpen(drawId);
          }}
        />
      )}
      {open && <DrawDrawer drawId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DrawForm({
  institutionId,
  year,
  onClose,
  onDone,
}: {
  institutionId: string;
  year: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const f = t.form;
  const qc = useQueryClient();
  const classes = useQuery({
    queryKey: ['admissions', institutionId, year],
    queryFn: () => api.get<Pipeline>(`/school/admissions/${institutionId}?year=${year}`),
  });
  const [classId, setClassId] = useState('');
  const [category, setCategory] = useState<Category>('rte');
  const [method, setMethod] = useState<'lottery' | 'first_come'>('lottery');
  const [siblingFirst, setSiblingFirst] = useState(false);
  const [seed, setSeed] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/school/admissions/${institutionId}/draws`, {
        yearLabel: year,
        classId,
        category,
        method,
        siblingFirst,
        seed: seed.trim() || null,
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['admission-draws'] });
      onDone(r.id);
    },
  });
  return (
    <FormModal
      title={t.newDraw}
      submitLabel={f.draw}
      cancelLabel={t.detail.close}
      pending={save.isPending}
      submitDisabled={!classId}
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={f.className}>
        <select className={fieldInput} value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">{en.surveys.choose}</option>
          {(classes.data?.classes ?? []).map((c) => (
            <option key={c.classId} value={c.classId}>
              {c.name}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.category}>
        <select
          className={fieldInput}
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {a.categories[c]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.method}>
        <select
          className={fieldInput}
          value={method}
          onChange={(e) => setMethod(e.target.value as 'lottery' | 'first_come')}
        >
          {(['lottery', 'first_come'] as const).map((m) => (
            <option key={m} value={m}>
              {t.methods[m]}
            </option>
          ))}
        </select>
      </ModalField>
      {method === 'lottery' && (
        <ModalField label={f.seed} hint={f.seedHint}>
          <input
            className={fieldInput}
            value={seed}
            maxLength={64}
            onChange={(e) => setSeed(e.target.value)}
          />
        </ModalField>
      )}
      <label className="flex items-start gap-2 sm:col-span-2">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-navy-950"
          checked={siblingFirst}
          onChange={(e) => setSiblingFirst(e.target.checked)}
        />
        <span className="flex flex-col">
          <span className="text-body text-ink">{f.siblingFirst}</span>
          <span className="text-caption text-ink-muted">{f.siblingFirstHint}</span>
        </span>
      </label>
    </FormModal>
  );
}

function DrawDrawer({ drawId, onClose }: { drawId: string; onClose: () => void }) {
  const dt = t.detail;
  const qc = useQueryClient();
  const [discarding, setDiscarding] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admission-draw', drawId],
    queryFn: () => api.get<DrawDetail>(`/school/admissions/draws/${drawId}`),
  });
  const refresh = async (msg: string) => {
    setNote(msg);
    for (const k of ['admission-draw', 'admission-draws', 'admissions'])
      await qc.invalidateQueries({ queryKey: [k] });
  };
  const publish = useMutation({
    mutationFn: () =>
      api.post<{ offered: number; waitlisted: number }>(
        `/school/admissions/draws/${drawId}/publish`,
      ),
    onSuccess: (r) => refresh(dt.published(r.offered, r.waitlisted)),
  });
  const discard = useMutation({
    mutationFn: () => api.post(`/school/admissions/draws/${drawId}/discard`, { reason }),
    onSuccess: async () => {
      setDiscarding(false);
      await refresh(dt.discarded);
    },
  });
  const d = q.data;
  const mine = !!d?.mine;
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={d ? `${d.className} · ${a.categories[d.category]}` : t.title}
      {...(d ? { subtitle: `${d.yearLabel} · ${t.methods[d.method]} · ${t.states[d.state]}` } : {})}
      closeLabel={dt.close}
    >
      <Announcer message={note} />
      {q.error ? (
        <StatePanel kind="error" title={errorText(q.error)} />
      ) : !d ? (
        <SkeletonRows label={t.title} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 rounded-lg bg-paper px-4 py-3">
            {d.method === 'lottery' && (
              <dl className="flex flex-wrap gap-x-2">
                <dt className="text-caption text-ink-muted">{dt.seed}</dt>
                <dd className="font-mono text-caption break-all text-ink">{d.seed}</dd>
              </dl>
            )}
            <p className="text-caption text-ink-muted">
              {d.method === 'lottery' ? dt.how : dt.howFirstCome}
            </p>
            <p
              className={cx(
                'flex items-center gap-1.5 text-caption font-medium',
                d.reproduces ? 'text-signal-go-ink' : 'text-signal-stop-ink',
              )}
            >
              {d.reproduces ? (
                <CircleCheck aria-hidden className="size-4" />
              ) : (
                <CircleAlert aria-hidden className="size-4" />
              )}
              {d.reproduces ? dt.checks : dt.checkFails}
            </p>
            <p className="text-caption text-ink-muted">
              {[
                t.drawnBy(d.drawnBy, when(d.drawnAt)),
                d.decidedBy && d.decidedAt ? t.decidedBy(d.decidedBy, when(d.decidedAt)) : null,
                d.discardReason,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {(publish.error || discard.error) && (
            <StatePanel kind="error" title={errorText(publish.error ?? discard.error)} />
          )}
          {d.state === 'drawn' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => publish.mutate()}
                  disabled={publish.isPending || mine || !d.reproduces}
                >
                  {dt.publish}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setDiscarding(true)}>
                  {dt.discard}
                </Button>
              </div>
              {mine && <p className="text-caption text-ink-muted">{dt.notYou}</p>}
            </div>
          )}
          <section aria-labelledby="draw-order" className="flex flex-col gap-2">
            <h3 id="draw-order" className="font-display text-lead font-semibold text-ink">
              {dt.ranked}
            </h3>
            <p className="text-caption text-ink-muted">{dt.seatLine(d.seatsFree)}</p>
            <ol className="flex flex-col divide-y divide-line">
              {d.ranked.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="w-8 text-right font-semibold text-ink tabular">{r.rank}</span>
                  <span className="min-w-0 flex-1 text-body text-ink">{r.childName}</span>
                  {r.sibling && <Pill>{dt.sibling}</Pill>}
                  <Pill tone={r.state === 'offered' ? 'go' : 'neutral'}>{a.states[r.state]}</Pill>
                </li>
              ))}
            </ol>
          </section>
          {d.leftOut.length > 0 && (
            <section aria-labelledby="draw-left-out" className="flex flex-col gap-2">
              <h3 id="draw-left-out" className="font-display text-lead font-semibold text-ink">
                {dt.leftOut}
              </h3>
              <ul className="flex flex-col divide-y divide-line">
                {d.leftOut.map((l) => (
                  <li key={l.id} className="flex flex-wrap gap-x-3 py-2 text-body">
                    <span className="text-ink">{l.childName}</span>
                    <span className="text-caption text-ink-muted">{dt.reasons[l.reason]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {discarding && (
        <FormModal
          title={dt.discard}
          submitLabel={dt.discard}
          cancelLabel={dt.close}
          pending={discard.isPending}
          submitDisabled={reason.trim().length < 3}
          error={discard.error ? errorText(discard.error) : null}
          size="md"
          onClose={() => setDiscarding(false)}
          onSubmit={() => discard.mutate()}
        >
          <ModalField label={dt.discardReason} wide>
            <textarea
              className={cx(fieldInput, 'h-auto py-2')}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </ModalField>
        </FormModal>
      )}
    </RecordDrawer>
  );
}
