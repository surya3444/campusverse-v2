'use client';

// Health Connect › Medicines & Stock (rule book §13.9): the health room's medicines, what's usable,
// what's low or expiring, and per medicine its batches and dispensing log. The medical role only.
import type { MedicineDetail, MedicineRow } from '@campusverse/shared-health';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Pill,
  RecordDrawer,
  Section,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, Pill as PillIcon, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';
import { errorText, when } from './common';

const t = en.health.stock;
const day = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${d}T00:00:00`),
  );

export function MedicinesSection({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MedicineRow | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['health-medicines', institutionId],
    queryFn: () => api.get<MedicineRow[]>(`/health/medicines?institutionId=${institutionId}`),
  });
  const refresh = async (msg: string) => {
    setNote(msg);
    await qc.invalidateQueries({ queryKey: ['health-medicines'] });
    await qc.invalidateQueries({ queryKey: ['health-medicine'] });
  };

  return (
    <Section
      id="health-medicines"
      title={t.title}
      description={t.lead}
      flush
      actions={
        <Button variant="secondary" size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden />
          {t.add}
        </Button>
      }
    >
      <Announcer message={note} />
      {list.error ? (
        <StatePanel kind="error" title={errorText(list.error)} />
      ) : !list.data ? (
        <div className="p-4">
          <SkeletonRows label={t.title} />
        </div>
      ) : list.data.length === 0 ? (
        <EmptyState icon={PillIcon} area="rose" title={t.none} body={t.noneBody} compact />
      ) : (
        <ul className="divide-y divide-line">
          {list.data.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(m.id)}
                className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-navy-950"
              >
                <span className="block font-medium text-ink">{m.name}</span>
                <span className="text-caption text-ink-muted">
                  {m.nextExpiry ? `${t.nextExpiry}: ${day(m.nextExpiry)}` : '—'}
                </span>
              </button>
              <span className="flex flex-wrap items-center gap-2">
                {!m.active && <Pill>{t.inactive}</Pill>}
                {m.low && <Pill tone="stop">{t.low}</Pill>}
                {m.expiringSoon > 0 && <Pill tone="warn">{t.expiring(m.expiringSoon)}</Pill>}
                <span className="tabular min-w-24 text-right text-body text-ink">
                  {m.inStock.toLocaleString('en-IN')} {m.unit}
                  <span className="sr-only"> {t.inStock}</span>
                </span>
                <Button variant="quiet" size="sm" onClick={() => setEditing(m)}>
                  {t.edit}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <MedicineForm
          institutionId={institutionId}
          medicine={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await refresh(t.saved);
          }}
        />
      )}
      {open && (
        <MedicineDrawer
          institutionId={institutionId}
          medicineId={open}
          onClose={() => setOpen(null)}
          onChanged={refresh}
        />
      )}
    </Section>
  );
}

function MedicineForm({
  institutionId,
  medicine,
  onClose,
  onDone,
}: {
  institutionId: string;
  medicine: MedicineRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(medicine?.name ?? '');
  const [unit, setUnit] = useState(medicine?.unit ?? '');
  const [reorder, setReorder] = useState(String(medicine?.reorderLevel ?? 0));
  const [active, setActive] = useState(medicine?.active ?? true);
  const body = () => ({ institutionId, name, unit, reorderLevel: Number(reorder) || 0, active });
  const save = useMutation({
    mutationFn: () =>
      medicine
        ? api.put(`/health/medicines/${medicine.id}`, body())
        : api.post('/health/medicines', body()),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={medicine ? t.edit : t.add}
      submitLabel={t.save}
      cancelLabel={en.health.emergency.cancel}
      pending={save.isPending}
      submitDisabled={name.trim().length < 2 || !unit.trim()}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.name} wide>
        <input
          className={fieldInput}
          value={name}
          placeholder={t.namePlaceholder}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.unit}>
        <input
          className={fieldInput}
          value={unit}
          placeholder={t.unitPlaceholder}
          maxLength={30}
          onChange={(e) => setUnit(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.reorder} hint={t.reorderHint}>
        <input
          className={cx(fieldInput, 'tabular')}
          type="number"
          min={0}
          value={reorder}
          onChange={(e) => setReorder(e.target.value)}
        />
      </ModalField>
      {medicine && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-navy-950"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <span className="text-body text-ink">{t.active}</span>
        </label>
      )}
    </FormModal>
  );
}

type Action = { kind: 'receive' } | { kind: 'give' } | { kind: 'discard'; batchId: string };

function MedicineDrawer({
  institutionId,
  medicineId,
  onClose,
  onChanged,
}: {
  institutionId: string;
  medicineId: string;
  onClose: () => void;
  onChanged: (note: string) => Promise<void>;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const q = useQuery({
    queryKey: ['health-medicine', medicineId],
    queryFn: () =>
      api.get<MedicineDetail>(`/health/medicines/${medicineId}?institutionId=${institutionId}`),
  });
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={q.data?.name ?? t.title}
      closeLabel={t.close}
    >
      {q.error ? (
        <StatePanel kind="error" title={errorText(q.error)} />
      ) : !q.data ? (
        <SkeletonRows label={t.title} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAction({ kind: 'receive' })}>
              <PackagePlus aria-hidden />
              {t.receive}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAction({ kind: 'give' })}>
              <PillIcon aria-hidden />
              {t.give}
            </Button>
          </div>
          <section aria-labelledby="health-batches" className="flex flex-col gap-2">
            <h3 id="health-batches" className="font-display text-lead font-semibold text-ink">
              {t.batches}
            </h3>
            {q.data.batches.length === 0 ? (
              <p className="text-body text-ink-muted">—</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {q.data.batches.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="flex items-center gap-2 text-body text-ink">
                      {t.expiresOn}: {day(b.expiresOn)}
                      {b.expired && <Pill tone="stop">{t.expired}</Pill>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular text-body text-ink">
                        {b.remaining} {q.data.unit}
                      </span>
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => setAction({ kind: 'discard', batchId: b.id })}
                      >
                        <Trash2 aria-hidden />
                        {t.discard}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="health-log" className="flex flex-col gap-2">
            <h3 id="health-log" className="font-display text-lead font-semibold text-ink">
              {t.log}
            </h3>
            {q.data.moves.length === 0 ? (
              <p className="text-body text-ink-muted">{t.noMoves}</p>
            ) : (
              <ol className="flex flex-col divide-y divide-line">
                {q.data.moves.map((m) => (
                  <li key={m.id} className="flex flex-col gap-0.5 py-2">
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-body text-ink">
                        {t.moves[m.kind]} ·{' '}
                        <span className="tabular">
                          {m.quantity} {q.data.unit}
                        </span>
                      </span>
                      <span className="text-caption text-ink-muted">{when(m.at)}</span>
                    </span>
                    <span className="text-caption text-ink-muted">
                      {t.by(m.by)}
                      {m.reason ? ` · ${m.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
      {action && (
        <StockForm
          institutionId={institutionId}
          medicineId={medicineId}
          action={action}
          onClose={() => setAction(null)}
          onDone={async (msg) => {
            setAction(null);
            await onChanged(msg);
          }}
        />
      )}
    </RecordDrawer>
  );
}

function StockForm({
  institutionId,
  medicineId,
  action,
  onClose,
  onDone,
}: {
  institutionId: string;
  medicineId: string;
  action: Action;
  onClose: () => void;
  onDone: (note: string) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState('1');
  const [expiresOn, setExpiresOn] = useState('');
  const [reason, setReason] = useState('');
  const n = Number(quantity);
  const go = useMutation({
    mutationFn: async () => {
      if (action.kind === 'receive')
        await api.post(`/health/medicines/${medicineId}/receive`, {
          institutionId,
          quantity: n,
          expiresOn,
        });
      else if (action.kind === 'give')
        await api.post(`/health/medicines/${medicineId}/dispense`, { institutionId, quantity: n });
      else
        await api.post('/health/stock/discard', {
          institutionId,
          batchId: action.batchId,
          quantity: n,
          reason,
        });
    },
    onSuccess: () =>
      onDone(
        action.kind === 'receive' ? t.received : action.kind === 'give' ? t.given : t.discarded,
      ),
  });
  const title =
    action.kind === 'receive' ? t.receive : action.kind === 'give' ? t.give : t.discardTitle;
  const valid =
    Number.isInteger(n) &&
    n > 0 &&
    (action.kind !== 'receive' || !!expiresOn) &&
    (action.kind !== 'discard' || reason.trim().length >= 3);
  return (
    <FormModal
      title={title}
      {...(action.kind === 'give' ? { description: t.giveHint } : {})}
      submitLabel={title}
      cancelLabel={en.health.emergency.cancel}
      pending={go.isPending}
      submitDisabled={!valid}
      error={go.error ? errorText(go.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => go.mutate()}
    >
      <ModalField label={t.quantity}>
        <input
          className={cx(fieldInput, 'tabular')}
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </ModalField>
      {action.kind === 'receive' && (
        <ModalField label={t.expiresOn}>
          <input
            className={fieldInput}
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </ModalField>
      )}
      {action.kind === 'discard' && (
        <ModalField label={t.reason} wide>
          <input
            className={fieldInput}
            value={reason}
            placeholder={t.reasonPlaceholder}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
          />
        </ModalField>
      )}
    </FormModal>
  );
}
