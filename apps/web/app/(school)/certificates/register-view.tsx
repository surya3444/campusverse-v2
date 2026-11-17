'use client';

import type { StudentListItem } from '@campusverse/people-records';
import type { CertificateSummary } from '@campusverse/school-certificates';
import { Button, EmptyState, FormModal, PageHeader, StatePanel, cx } from '@campusverse/ui';
import { FileBadge, Plus } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';

const t = en.certificates;
export const certError = (e: unknown): string =>
  t.errors[e instanceof ApiFailure ? e.code : 'error'] ?? t.errors.error ?? '';
const field =
  'h-9 rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';
export const STATE_CHIP: Record<string, string> = {
  issued: 'bg-signal-go-tint text-signal-go-ink',
  delivered: 'bg-signal-go-tint text-signal-go-ink',
  approved: 'bg-navy-50 text-navy-700',
  ready_for_review: 'bg-signal-warn-tint text-signal-warn-ink',
  clearance_pending: 'bg-signal-stop-tint text-signal-stop-ink',
  requested: 'bg-paper text-ink-muted',
  cancelled: 'bg-paper text-ink-faint',
  superseded: 'bg-paper text-ink-faint',
};

export function RegisterView() {
  const school = useInstitution();
  const id = school.institutionId;
  const list = useQuery({
    queryKey: ['certificates', id],
    queryFn: () => api.get<CertificateSummary[]>(`/school/certificates/institution/${id}`),
    enabled: !!id,
  });
  const [open, setOpen] = useState(useSearchParams().has('new'));
  if (school.isPending || (list.isPending && !!id))
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (list.isError || school.isError) {
    return list.error instanceof ApiFailure && list.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={certError(list.error ?? school.error)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={FileBadge}
        art="certificates"
        eyebrow={en.nav.groups.academics}
        area="amber"
        title={t.title}
        description={t.lead}
        actions={
          <Button onClick={() => setOpen(true)} aria-haspopup="dialog">
            <Plus aria-hidden className="size-4" />
            {t.request}
          </Button>
        }
      />
      {open && id && <RequestForm institutionId={id} onClose={() => setOpen(false)} />}
      {!list.data || list.data.length === 0 ? (
        <div className="panel">
          <EmptyState
            art="certificates"
            icon={FileBadge}
            area="amber"
            title={t.empty}
            body={t.emptyBody}
          />
        </div>
      ) : (
        <ul className="panel divide-y divide-line">
          {list.data.map((c) => (
            <li key={c.id}>
              <Link
                href={`/certificates/${c.id}`}
                className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-navy-950">{c.student}</span>
                  <span className="text-caption text-ink-muted">
                    {t.kinds[c.kind]}
                    {c.number && ` · ${c.number}`}
                    {c.dueBy &&
                      !['issued', 'delivered', 'cancelled'].includes(c.state) &&
                      ` · ${t.dueBy(c.dueBy)}`}
                  </span>
                </span>
                <span
                  className={cx(
                    'rounded-full px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
                    STATE_CHIP[c.state],
                  )}
                >
                  {t.states[c.state]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestForm({ institutionId, onClose }: { institutionId: string; onClose: () => void }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [studentId, setStudentId] = useState('');
  const [kind, setKind] = useState<'tc' | 'bonafide' | 'fee_paid'>('bonafide');
  const [purpose, setPurpose] = useState('');
  const [leavingDate, setLeavingDate] = useState('');
  const [leavingReason, setLeavingReason] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(h);
  }, [search]);
  const found = useQuery({
    queryKey: ['cert-students', institutionId, q],
    queryFn: () =>
      api.get<StudentListItem[]>(
        `/people/students?institutionId=${institutionId}&search=${encodeURIComponent(q)}`,
      ),
    enabled: q.length >= 2,
  });
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/school/certificates', {
        studentId,
        kind,
        purpose: purpose || null,
        leavingDate: kind === 'tc' ? leavingDate : null,
        leavingReason: kind === 'tc' ? leavingReason : null,
      }),
    onSuccess: (r) => router.push(`/certificates/${r.id}`),
  });
  return (
    <FormModal
      title={t.request}
      submitLabel={t.requestAction}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={!studentId}
      error={save.isError ? certError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <label className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="text-caption font-medium text-ink">{t.findStudent}</span>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setStudentId('');
          }}
          className={field}
        />
      </label>
      {q.length >= 2 && !studentId && (
        <ul className="flex flex-col gap-1 sm:col-span-2">
          {(found.data ?? []).slice(0, 8).map((s) => (
            <li key={s.personId}>
              <button
                type="button"
                onClick={() => {
                  setStudentId(s.personId);
                  setSearch(s.name);
                }}
                className="w-full rounded-md px-2 py-1.5 text-left text-body text-navy-950 hover:bg-navy-50"
              >
                {s.name} <span className="text-caption text-ink-muted">{s.placement}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.kind}</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className={field}
        >
          {Object.entries(t.kinds).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {kind === 'tc' ? (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.leavingDate}</span>
            <input
              type="date"
              required
              value={leavingDate}
              onChange={(e) => setLeavingDate(e.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-caption font-medium text-ink">{t.leavingReason}</span>
            <input
              required
              minLength={3}
              value={leavingReason}
              onChange={(e) => setLeavingReason(e.target.value)}
              className={field}
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.purpose}</span>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} className={field} />
        </label>
      )}
    </FormModal>
  );
}
