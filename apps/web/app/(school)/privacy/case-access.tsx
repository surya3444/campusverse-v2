'use client';

// Privacy & Consent › Case access (rule book §10.3): "Group owners and principals see health
// totals, never names, unless granted for a case. Every such grant is logged." The Data
// Protection Officer grants one sensitive permission about one person, for up to a week.
import type { CaseGrantRow } from '@campusverse/platform-access';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';

const t = en.privacy.cases;
/** The sensitive permissions a case can open (data class "sensitive" in the access catalogue). */
const CASE_PERMISSIONS = [
  'health.record.read',
  'health.record.update',
  'health.visit.record',
  'people.student.reveal',
  'people.staff.reveal',
  'people.staff.documents',
];
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

export function CaseAccess({
  manage,
  granting,
  onGranting,
}: {
  manage: boolean;
  granting: boolean;
  onGranting: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['case-grants'],
    queryFn: () => api.get<CaseGrantRow[]>('/access/cases'),
  });
  const end = useMutation({
    mutationFn: (id: string) => api.post(`/access/cases/${id}/end`, {}),
    onSettled: () => qc.invalidateQueries({ queryKey: ['case-grants'] }),
  });
  return (
    <Section id="case-access" title={t.title} description={t.lead} flush>
      {q.error ? (
        <div className="px-6 pb-5">
          <StatePanel
            kind={q.error instanceof ApiFailure && q.error.status === 403 ? 'denied' : 'error'}
            title={errorText(q.error)}
          />
        </div>
      ) : !q.data ? (
        <div className="px-6 pb-5">
          <SkeletonRows rows={3} label={en.states.loading.title} />
        </div>
      ) : q.data.length === 0 ? (
        <EmptyState icon={KeyRound} area="navy" title={t.none} compact />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {q.data.map((g) => (
            <li key={g.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-6 py-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{t.line(g.grantee, g.subject)}</span>
                  <Pill tone={g.running ? 'warn' : 'neutral'}>
                    {g.running ? t.running : g.endedAt ? t.ended : t.expired}
                  </Pill>
                </p>
                <p className="text-caption text-ink">
                  {(en.permissionNames as Record<string, string>)[g.permission] ?? g.permission}
                  {g.running ? ` · ${t.until(when(g.expiresAt))}` : ''}
                </p>
                <p className="text-caption text-ink-muted">{g.reason}</p>
                <p className="text-caption text-ink-muted">
                  {t.by(g.grantedBy, when(g.grantedAt))}
                </p>
              </div>
              {g.running && manage && (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={t.endFor(g.grantee)}
                  disabled={end.isPending}
                  onClick={() => end.mutate(g.id)}
                >
                  {t.end}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {granting && <GrantForm onClose={() => onGranting(false)} />}
    </Section>
  );
}

function GrantForm({ onClose }: { onClose: () => void }) {
  const f = t.form;
  const school = useInstitution();
  const qc = useQueryClient();
  const [granteeId, setGranteeId] = useState('');
  const [permission, setPermission] = useState(CASE_PERMISSIONS[0] ?? '');
  const [find, setFind] = useState('');
  const [subject, setSubject] = useState<{ personId: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('24');
  const staff = useQuery({
    queryKey: ['access-people'],
    queryFn: () =>
      api.get<{ assignments: { personId: string }[]; names: Record<string, string> }>(
        '/access/people',
      ),
  });
  const people = staff.data
    ? [...new Set(staff.data.assignments.map((a) => a.personId))]
        .map((id) => ({ id, name: staff.data.names[id] ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(find.trim()), 200);
    return () => clearTimeout(h);
  }, [find]);
  const found = useQuery({
    queryKey: ['case-find', school.institutionId, debounced],
    queryFn: () =>
      api.get<{ personId: string; name: string }[]>(
        `/people/students?institutionId=${school.institutionId}&search=${encodeURIComponent(debounced)}`,
      ),
    enabled: !!school.institutionId && debounced.length >= 2 && !subject,
  });
  const save = useMutation({
    mutationFn: () =>
      api.post('/access/cases', {
        granteeId,
        permission,
        subjectId: subject?.personId,
        reason,
        hours: Number(hours),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['case-grants'] });
      onClose();
    },
  });
  return (
    <FormModal
      title={t.grant}
      description={t.lead}
      submitLabel={t.grant}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={!granteeId || !subject || reason.trim().length < 10}
      error={save.isError ? errorText(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={f.grantee}>
        <select
          value={granteeId}
          onChange={(e) => setGranteeId(e.target.value)}
          className={fieldInput}
        >
          <option value="" />
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.permission}>
        <select
          value={permission}
          onChange={(e) => setPermission(e.target.value)}
          className={fieldInput}
        >
          {CASE_PERMISSIONS.map((p) => (
            <option key={p} value={p}>
              {(en.permissionNames as Record<string, string>)[p] ?? p}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.subject} hint={subject ? undefined : f.find} wide>
        {subject ? (
          <span className="flex items-center gap-2">
            <span className="text-body text-ink">{subject.name}</span>
            <Button size="sm" variant="quiet" onClick={() => setSubject(null)}>
              {en.form.cancel}
            </Button>
          </span>
        ) : (
          <input value={find} onChange={(e) => setFind(e.target.value)} className={fieldInput} />
        )}
      </ModalField>
      {!subject && (found.data?.length ?? 0) > 0 && (
        <ul className="flex flex-col gap-1 sm:col-span-2">
          {found.data?.slice(0, 6).map((s) => (
            <li key={s.personId}>
              <button
                type="button"
                onClick={() => setSubject(s)}
                className="w-full rounded-md px-3 py-1.5 text-left text-body text-navy-950 hover:bg-navy-50"
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ModalField label={f.reason} wide>
        <textarea
          required
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.hours}>
        <select value={hours} onChange={(e) => setHours(e.target.value)} className={fieldInput}>
          {Object.entries(f.durations).map(([h, label]) => (
            <option key={h} value={h}>
              {label}
            </option>
          ))}
        </select>
      </ModalField>
    </FormModal>
  );
}
