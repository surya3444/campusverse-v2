'use client';

// Health Connect › Emergency (rule book §13.9, §16.5): every SOS at the school, closed with a
// sealed report, and the hospital and ambulance numbers shown to whoever raises one.
import type { IncidentOutcome, IncidentRow, Partner } from '@campusverse/shared-health';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Plus, Siren } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';
import { errorText, when } from './common';

const t = en.health.incidents;
const p = en.health.partners;
const OUTCOMES: IncidentOutcome[] = ['resolved_on_site', 'sent_home', 'hospital', 'false_alarm'];
const KINDS = ['hospital', 'ambulance', 'clinic', 'pharmacy'] as const;

export function IncidentsSection({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const [closing, setClosing] = useState<IncidentRow | null>(null);
  const [report, setReport] = useState<{ id: string; text: string | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['health-incidents', institutionId],
    queryFn: () => api.get<IncidentRow[]>(`/health/incidents?institutionId=${institutionId}`),
    refetchInterval: 30_000,
  });
  const read = useMutation({
    mutationFn: (id: string) =>
      api.get<{ report: string | null }>(
        `/health/incidents/${id}/report?institutionId=${institutionId}`,
      ),
    onSuccess: (r, id) => setReport({ id, text: r.report }),
  });
  return (
    <Section id="health-incidents" title={t.title} description={t.lead} flush>
      <Announcer message={note} />
      {list.error ? (
        <StatePanel kind="error" title={errorText(list.error)} />
      ) : !list.data ? (
        <div className="p-4">
          <SkeletonRows label={t.title} />
        </div>
      ) : list.data.length === 0 ? (
        <EmptyState icon={Siren} area="rose" title={t.none} body={t.noneBody} compact />
      ) : (
        <ul className="divide-y divide-line">
          {list.data.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 px-5 py-3">
              <span className="flex flex-wrap items-center gap-2">
                <Pill tone={i.closedAt ? 'neutral' : 'stop'}>{i.closedAt ? t.closed : t.open}</Pill>
                <span className="font-medium text-ink">
                  {t.kinds[i.kind]} · {i.location}
                </span>
                {i.student && <span className="text-body text-ink">· {i.student}</span>}
                {i.outcome && <Pill>{t.outcomes[i.outcome]}</Pill>}
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-caption text-ink-muted">
                  {t.raisedBy(i.raisedBy, when(i.raisedAt))}
                </span>
                {i.closedAt ? (
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={read.isPending && read.variables === i.id}
                    onClick={() => read.mutate(i.id)}
                  >
                    {t.readReport}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setClosing(i)}>
                    {t.close}
                  </Button>
                )}
              </span>
              {report?.id === i.id && (
                <p className="rounded-lg bg-paper px-3 py-2 text-body text-ink">
                  {report.text ?? '—'}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {closing && (
        <CloseForm
          institutionId={institutionId}
          incident={closing}
          onClose={() => setClosing(null)}
          onDone={async () => {
            setClosing(null);
            setNote(t.closedToast);
            await qc.invalidateQueries({ queryKey: ['health-incidents'] });
          }}
        />
      )}
    </Section>
  );
}

function CloseForm({
  institutionId,
  incident,
  onClose,
  onDone,
}: {
  institutionId: string;
  incident: IncidentRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<IncidentOutcome>('resolved_on_site');
  const [report, setReport] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post(`/health/incidents/${incident.id}/close`, { institutionId, outcome, report }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.closeTitle}
      description={`${t.kinds[incident.kind]} · ${incident.location}`}
      submitLabel={t.close}
      cancelLabel={en.health.emergency.cancel}
      pending={save.isPending}
      submitDisabled={report.trim().length < 10}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.outcome}>
        <select
          className={fieldInput}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as IncidentOutcome)}
        >
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {t.outcomes[o]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.report} hint={t.reportHint} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={4}
          maxLength={4000}
          value={report}
          onChange={(e) => setReport(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

export function PartnersSection({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partner | 'new' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['health-partners', institutionId],
    queryFn: () => api.get<Partner[]>(`/health/partners?institutionId=${institutionId}`),
  });
  return (
    <Section
      id="health-partners"
      title={p.title}
      description={p.lead}
      flush
      actions={
        <Button variant="secondary" size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden />
          {p.add}
        </Button>
      }
    >
      <Announcer message={note} />
      {list.error ? (
        <StatePanel kind="error" title={errorText(list.error)} />
      ) : !list.data ? (
        <div className="p-4">
          <SkeletonRows label={p.title} />
        </div>
      ) : list.data.length === 0 ? (
        <p className="px-5 py-4 text-body text-ink-muted">{p.none}</p>
      ) : (
        <ol className="divide-y divide-line">
          {list.data.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Phone aria-hidden className="size-4 text-ink-muted" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">{x.name}</span>
                <span className="text-caption text-ink-muted">
                  {p.kinds[x.kind]} · <span className="tabular">{x.phone}</span>
                  {x.address ? ` · ${x.address}` : ''}
                </span>
              </span>
              {!x.active && <Pill>{en.health.stock.inactive}</Pill>}
              <Button variant="quiet" size="sm" onClick={() => setEditing(x)}>
                {p.edit}
              </Button>
            </li>
          ))}
        </ol>
      )}
      {editing && (
        <PartnerForm
          institutionId={institutionId}
          partner={editing === 'new' ? null : editing}
          next={list.data?.length ?? 0}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            setNote(p.saved);
            await qc.invalidateQueries({ queryKey: ['health-partners'] });
          }}
        />
      )}
    </Section>
  );
}

function PartnerForm({
  institutionId,
  partner,
  next,
  onClose,
  onDone,
}: {
  institutionId: string;
  partner: Partner | null;
  next: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(partner?.name ?? '');
  const [kind, setKind] = useState<Partner['kind']>(partner?.kind ?? 'hospital');
  const [phone, setPhone] = useState(partner?.phone ?? '');
  const [address, setAddress] = useState(partner?.address ?? '');
  const [sort, setSort] = useState(String(partner ? 0 : next));
  const [active, setActive] = useState(partner?.active ?? true);
  const body = () => ({
    institutionId,
    name,
    kind,
    phone,
    address: address.trim() || null,
    sort: Number(sort) || 0,
    active,
  });
  const save = useMutation({
    mutationFn: () =>
      partner
        ? api.put(`/health/partners/${partner.id}`, body())
        : api.post('/health/partners', body()),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={partner ? p.edit : p.add}
      submitLabel={p.save}
      cancelLabel={en.health.emergency.cancel}
      pending={save.isPending}
      submitDisabled={name.trim().length < 2 || !/^[0-9+ -]{6,20}$/.test(phone.trim())}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={p.name} wide>
        <input
          className={fieldInput}
          value={name}
          maxLength={160}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      <ModalField label={p.kind}>
        <select
          className={fieldInput}
          value={kind}
          onChange={(e) => setKind(e.target.value as Partner['kind'])}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {p.kinds[k]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={p.phone}>
        <input
          className={cx(fieldInput, 'tabular')}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </ModalField>
      <ModalField label={p.address} wide>
        <input
          className={fieldInput}
          value={address}
          maxLength={300}
          onChange={(e) => setAddress(e.target.value)}
        />
      </ModalField>
      <ModalField label={p.order}>
        <input
          className={cx(fieldInput, 'tabular')}
          type="number"
          min={0}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        />
      </ModalField>
      <label className="flex items-center gap-2 self-end pb-2.5">
        <input
          type="checkbox"
          className="size-4 accent-navy-950"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        <span className="text-body text-ink">{p.active}</span>
      </label>
    </FormModal>
  );
}
