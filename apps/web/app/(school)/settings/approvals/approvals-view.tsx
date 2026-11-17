'use client';

// Campus Core › Workflow & Approvals, the designer (rule book §12.4 decision 6, §10.2 "every
// institution can change it in the shared approval designer"): steps by role, amount limits and
// escalation, for the organisation or one institution.
import type { PolicyStep, ProcessPolicy } from '@campusverse/platform-workflow';
import { Button, FormModal, Section, SkeletonRows, StatePanel } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { rupees } from '../../../../lib/money';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { fieldInput } from '../../common/custom-fields';
import { SettingsFrame } from '../frame';

const t = en.workflow;
type Design = { processes: ProcessPolicy[]; roles: { key: string; name: string }[] };
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

export function ApprovalsView() {
  const institutions = useInstitution();
  const [scope, setScope] = useState<string>('');
  const [editing, setEditing] = useState<ProcessPolicy | null>(null);
  const q = useQuery({
    queryKey: ['approval-design', scope],
    queryFn: () => api.get<Design>(`/workflow/design${scope ? `?institutionId=${scope}` : ''}`),
  });
  const d = q.data;
  const roleName = (key: string) => d?.roles.find((r) => r.key === key)?.name ?? key;
  const permissionName = (p: string) => (en.permissionNames as Record<string, string>)[p] ?? p;

  return (
    <SettingsFrame title={t.designTitle} lead={t.designLead}>
      <label className="flex max-w-md flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.scope}</span>
        <select value={scope} onChange={(e) => setScope(e.target.value)} className={fieldInput}>
          <option value="">{t.wholeOrg}</option>
          {(institutions.data ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
      {q.error ? (
        <StatePanel
          kind={q.error instanceof ApiFailure && q.error.status === 403 ? 'denied' : 'error'}
          title={
            q.error instanceof ApiFailure && q.error.status === 403
              ? en.states.denied.title
              : (t.errors.error ?? '')
          }
          body={t.errors.forbidden ?? ''}
        />
      ) : !d ? (
        <SkeletonRows rows={4} label={en.states.loading.title} />
      ) : (
        <>
          {d.processes.map((p) => {
            const name = t.processes[p.process] ?? p.process;
            return (
              <Section
                key={p.process}
                id={`process-${p.process.replace('.', '-')}`}
                title={name}
                description={t.processLeads[p.process]}
                actions={
                  <Button variant="secondary" size="sm" onClick={() => setEditing(p)}>
                    {t.change}
                  </Button>
                }
              >
                {scope && (
                  <p className="mb-3 text-caption text-ink-muted">
                    {p.inherited ? t.inherited : t.ownSteps}
                  </p>
                )}
                {p.steps.length === 0 ? (
                  <p className="text-body text-ink-muted">
                    {t.noSteps(permissionName(p.permission))}
                  </p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {p.steps.map((s, i) => (
                      <li
                        key={`${s.role}-${i}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-4 py-2.5"
                      >
                        <span className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
                          {t.step(i + 1)}
                        </span>
                        <span className="font-medium text-ink">{roleName(s.role)}</span>
                        {s.minAmountPaise !== null && (
                          <span className="tabular text-caption text-ink-muted">
                            {t.fromAmount(rupees(s.minAmountPaise))}
                          </span>
                        )}
                        {s.hours && s.escalateTo && (
                          <span className="text-caption text-ink-muted">
                            · {t.escalation(s.hours, roleName(s.escalateTo))}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
            );
          })}
          <p className="text-caption text-ink-muted">{t.designNote}</p>
        </>
      )}
      {editing && d && (
        <StepsForm
          policy={editing}
          roles={d.roles}
          institutionId={scope || null}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsFrame>
  );
}

type Row = { role: string; from: string; hours: string; escalateTo: string };
const toRow = (s: PolicyStep): Row => ({
  role: s.role,
  from: s.minAmountPaise === null ? '' : String(s.minAmountPaise / 100),
  hours: s.hours ? String(s.hours) : '',
  escalateTo: s.escalateTo ?? '',
});

function StepsForm({
  policy: p,
  roles,
  institutionId,
  onClose,
}: {
  policy: ProcessPolicy;
  roles: { key: string; name: string }[];
  institutionId: string | null;
  onClose: () => void;
}) {
  const f = t.form;
  const name = t.processes[p.process] ?? p.process;
  const [rows, setRows] = useState<Row[]>(
    p.steps.length
      ? p.steps.map(toRow)
      : [{ role: roles[0]?.key ?? '', from: '', hours: '', escalateTo: '' }],
  );
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (steps: Row[]) =>
      api.post('/workflow/design', {
        process: p.process,
        institutionId,
        steps: steps.map((r) => ({
          role: r.role,
          minAmountPaise: p.amounts && r.from.trim() ? Math.round(Number(r.from) * 100) : null,
          hours: r.hours.trim() && r.escalateTo ? Number(r.hours) : null,
          escalateTo: r.hours.trim() && r.escalateTo ? r.escalateTo : null,
        })),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['approval-design'] });
      onClose();
    },
  });
  const set = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const half = (i: number) => !!rows[i]?.hours.trim() !== !!rows[i]?.escalateTo;

  return (
    <FormModal
      title={t.changeFor(name)}
      description={t.designNote}
      size="lg"
      submitLabel={en.form.save}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={rows.some((r, i) => !r.role || half(i))}
      error={save.isError ? errorText(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate(rows)}
    >
      {rows.map((r, i) => (
        <fieldset
          key={i}
          className="flex flex-col gap-3 rounded-lg border border-line p-4 sm:col-span-2"
        >
          <legend className="px-1 text-caption font-semibold text-ink">{t.step(i + 1)}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{f.role}</span>
              <select
                value={r.role}
                onChange={(e) => set(i, { role: e.target.value })}
                className={fieldInput}
              >
                {roles.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            {p.amounts && (
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-ink">{f.from}</span>
                <input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={r.from}
                  onChange={(e) => set(i, { from: e.target.value })}
                  aria-describedby={`from-hint-${i}`}
                  className={fieldInput}
                />
                <span id={`from-hint-${i}`} className="text-caption text-ink-muted">
                  {f.fromHint}
                </span>
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{f.hours}</span>
              <input
                type="number"
                min={1}
                max={720}
                inputMode="numeric"
                value={r.hours}
                onChange={(e) => set(i, { hours: e.target.value })}
                className={fieldInput}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{f.escalateTo}</span>
              <select
                value={r.escalateTo}
                onChange={(e) => set(i, { escalateTo: e.target.value })}
                className={fieldInput}
              >
                <option value="">{f.none}</option>
                {roles.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button
            variant="quiet"
            size="sm"
            className="self-start"
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            <Trash2 aria-hidden />
            {t.removeStep(i + 1)}
          </Button>
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        {rows.length < 6 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setRows([...rows, { role: roles[0]?.key ?? '', from: '', hours: '', escalateTo: '' }])
            }
          >
            <Plus aria-hidden />
            {t.addStep}
          </Button>
        )}
        {institutionId && !p.inherited && (
          <Button
            variant="quiet"
            size="sm"
            disabled={save.isPending}
            onClick={() => save.mutate([])}
          >
            {t.useOrg}
          </Button>
        )}
      </div>
    </FormModal>
  );
}
