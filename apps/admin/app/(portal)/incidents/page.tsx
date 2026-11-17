'use client';

import type { CustomerSummary, IncidentRow } from '@campusverse/platform-control';
import { Button, PageHeader } from '@campusverse/ui';
import { ShieldAlert } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { at, Chip, Field, Loaded, Notice, Panel, field } from '../../../lib/ui';
import { en } from '../../../messages/en';

const t = en.incidents;
const STEPS = ['certin_reported', 'board_notified', 'schools_notified'] as const;
const CLOCK = {
  certin_reported: 'certin',
  board_notified: 'board',
  schools_notified: 'schools',
} as const;

export default function IncidentsPage() {
  const list = useQuery({
    queryKey: ['incidents'],
    queryFn: () => api.get<IncidentRow[]>('/incidents'),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={ShieldAlert} area="rose" title={t.title} description={t.lead} />
      <OpenIncident />
      <Loaded q={list}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-body text-ink-muted">{t.none}</p>
          ) : (
            rows.map((i) => <Incident key={i.id} incident={i} />)
          )
        }
      </Loaded>
    </div>
  );
}

function Incident({ incident: i }: { incident: IncidentRow }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const step = useMutation({
    mutationFn: (v: { step: string; note?: string }) => api.post(`/incidents/${i.id}/steps`, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['incidents'] }),
  });
  return (
    <Panel title={i.title}>
      <div className="flex flex-col gap-3 p-5">
        <p className="text-caption text-ink-muted">
          {t.openedBy(i.openedBy, at(i.discoveredAt))}
          {i.customers.length > 0 && ` · ${i.customers.map((c) => c.name).join(', ')}`}
        </p>
        <p className="text-body whitespace-pre-line text-ink">{i.details}</p>
        <ul className="flex flex-col gap-2">
          {STEPS.map((s) => {
            const c = i.clocks[CLOCK[s]];
            if (!c) return null;
            return (
              <li key={s} className="flex flex-wrap items-center gap-3">
                <span className="min-w-56 text-body text-ink">{t.steps[s]}</span>
                {c.doneAt ? (
                  <Chip tone="approved">{t.doneAt(at(c.doneAt))}</Chip>
                ) : (
                  <>
                    <Chip tone={c.overdue ? 'on' : 'requested'}>
                      {c.overdue ? `${t.overdue} · ${t.due(at(c.due))}` : t.due(at(c.due))}
                    </Chip>
                    {!i.closedAt && (
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t.markDone(t.steps[s] ?? s)}
                        disabled={step.isPending}
                        onClick={() => step.mutate({ step: s })}
                      >
                        {t.done}
                      </Button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {i.closedAt ? (
          <p className="text-caption text-ink-muted">
            {t.closed(at(i.closedAt))} · {i.closingNote}
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t.closingNote} className="min-w-64 flex-1">
              <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
            </Field>
            <Button
              variant="quiet"
              disabled={step.isPending || note.trim().length < 3}
              onClick={() => step.mutate({ step: 'closed', note })}
            >
              {t.close}
            </Button>
          </div>
        )}
        <Notice error={step.error} />
      </div>
    </Panel>
  );
}

function OpenIncident() {
  const qc = useQueryClient();
  const customers = useQuery({
    queryKey: ['customers', ''],
    queryFn: () => api.get<CustomerSummary[]>('/customers'),
  });
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [discovered, setDiscovered] = useState('');
  const [personalData, setPersonalData] = useState(true);
  const [orgIds, setOrgIds] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () =>
      api.post('/incidents', {
        title,
        details,
        discoveredAt: new Date(discovered).toISOString(),
        personalData,
        orgIds,
      }),
    onSuccess: () => {
      setTitle('');
      setDetails('');
      setOrgIds([]);
      void qc.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} aria-label={t.open} className="panel grid gap-3 p-5 sm:grid-cols-2">
      <Field label={t.titleField} className="sm:col-span-2">
        <input
          required
          minLength={3}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t.details} className="sm:col-span-2">
        <textarea
          required
          minLength={10}
          rows={4}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          className={`${field} h-auto py-2`}
        />
      </Field>
      <Field label={t.discoveredAt}>
        <input
          required
          type="datetime-local"
          value={discovered}
          onChange={(e) => setDiscovered(e.target.value)}
          className={field}
        />
      </Field>
      <label className="flex items-center gap-2 self-end text-body text-ink">
        <input
          type="checkbox"
          checked={personalData}
          onChange={(e) => setPersonalData(e.target.checked)}
        />
        {t.personalData}
      </label>
      <Field label={t.customers} className="sm:col-span-2">
        <select
          multiple
          value={orgIds}
          onChange={(e) => setOrgIds([...e.target.selectedOptions].map((o) => o.value))}
          className={`${field} h-28 py-1`}
        >
          {(customers.data ?? []).map((c) => (
            <option key={c.orgId} value={c.orgId}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        <div className="flex-1">
          <Notice error={save.error} ok={save.isSuccess && t.saved} />
        </div>
        <Button type="submit" disabled={save.isPending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}
