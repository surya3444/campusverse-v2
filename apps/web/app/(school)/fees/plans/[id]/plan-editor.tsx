'use client';

import type { AudienceGroup } from '@campusverse/shared-communications';
import type { Head, IssuePreview, PlanDetail } from '@campusverse/shared-finance';
import { Announcer, Button, PreviewCanvas, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { parseRupees, percent, rupees } from '../../../../../lib/money';
import { en } from '../../../../../messages/en';
import { useInstitution } from '../../../attendance/shared';
import { api, feeError, t } from '../../shared';

const field =
  'h-9 rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';
type Inst = { label: string; dueOn: string; share: string };

/** A draft plan is edited here; a published one is read-only, with "Change fees (new version)" and "Issue invoices". */
export function PlanEditor({ planId }: { planId: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const school = useInstitution();
  const id = school.institutionId;
  const plan = useQuery({
    queryKey: ['fee-plan', planId],
    queryFn: () => api.get<PlanDetail>(`/finance/plans/${planId}`),
    enabled: !!planId,
  });
  const heads = useQuery({
    queryKey: ['fee-heads', id],
    queryFn: () => api.get<Head[]>(`/finance/${id}/heads`),
    enabled: !!id,
  });
  const groups = useQuery({
    queryKey: ['audience-groups', id],
    queryFn: () => api.get<AudienceGroup[]>(`/communications/${id}/audience-groups`),
    enabled: !!id,
  });
  const [name, setName] = useState('');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [insts, setInsts] = useState<Inst[]>([{ label: 'Annual', dueOn: '', share: '100' }]);
  const [lateFee, setLateFee] = useState('0');
  const [grace, setGrace] = useState('0');
  const [editing, setEditing] = useState(planId === null);
  const [preview, setPreview] = useState<IssuePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const p = plan.data;
    if (!p) return;
    setName(p.name);
    setGroupIds(p.groupIds);
    setAmounts(
      Object.fromEntries(p.lines.map((l) => [l.headId, rupees(l.amountPaise).replace('₹', '')])),
    );
    setInsts(
      p.instalments.map((i) => ({
        label: i.label,
        dueOn: i.dueOn,
        share: percent(i.shareBp).replace('%', ''),
      })),
    );
    setLateFee(rupees(p.lateFeePaise).replace('₹', ''));
    setGrace(String(p.graceDays));
    setEditing(p.state === 'draft');
  }, [plan.data]);

  const lines = Object.entries(amounts)
    .map(([headId, v]) => ({ headId, amountPaise: parseRupees(v) ?? 0 }))
    .filter((l) => l.amountPaise > 0);
  const shares = insts.map((i) => parseRupees(i.share) ?? 0); // "33.34" → 3334 basis points
  const sharesTotal = shares.reduce((a, b) => a + b, 0);
  const total = lines.reduce((a, l) => a + l.amountPaise, 0);

  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/finance/${id}/plans`, {
        ...(planId ? { planId } : {}),
        name,
        groupIds,
        lines,
        instalments: insts.map((i, n) => ({
          label: i.label,
          dueOn: i.dueOn,
          shareBp: shares[n] ?? 0,
        })),
        lateFeePaise: parseRupees(lateFee) ?? 0,
        graceDays: Number(grace) || 0,
      }),
    onSuccess: (r) => {
      setMessage(t.saved);
      void qc.invalidateQueries({ queryKey: ['fee-plans', id] });
      if (r.id !== planId) router.replace(`/fees/plans/${r.id}`);
      else void plan.refetch();
    },
  });
  const publish = useMutation({
    mutationFn: () => api.post(`/finance/plans/${planId}/publish`),
    onSuccess: () => {
      setMessage(t.published);
      void plan.refetch();
    },
  });
  const ask = useMutation({
    mutationFn: () => api.post<IssuePreview>(`/finance/plans/${planId}/issue/preview`),
    onSuccess: setPreview,
  });
  const issue = useMutation({
    mutationFn: () => api.post<IssuePreview>(`/finance/plans/${planId}/issue`),
    onSuccess: (r) => {
      setPreview(null);
      setMessage(t.issued(r.invoices));
      void plan.refetch();
    },
  });

  if (school.isPending || heads.isPending || (planId && plan.isPending))
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (heads.isError || plan.isError)
    return (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={feeError(heads.error ?? plan.error)}
      />
    );
  const p = plan.data;
  const error = save.error ?? publish.error ?? ask.error ?? issue.error;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Link
        href="/fees/plans"
        className="inline-flex items-center gap-1.5 self-start text-body text-navy-950 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.plans}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-title font-semibold text-ink">
          {p ? `${p.name} ${t.version(p.version)}` : t.newPlan}
        </h1>
        {p && (
          <span className="rounded-full bg-paper px-2.5 py-0.5 text-caption text-ink-muted">
            {t.states[p.state]}
          </span>
        )}
      </div>

      {p?.state === 'published' && p.invoicesIssued === 0 && !editing && (
        <div className="panel flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-navy-950 p-4">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-ink">{t.nextIssueTitle}</span>
            <span className="text-caption text-ink-muted">{t.nextIssueBody}</span>
          </div>
          <Button disabled={ask.isPending} onClick={() => ask.mutate()}>
            {t.issue}
          </Button>
        </div>
      )}

      <fieldset disabled={!editing} className="panel flex flex-col gap-4 p-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.planName}</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field}
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.appliesTo}</span>
          <div className="flex flex-wrap gap-2">
            {(groups.data ?? []).map((g) => {
              const on = groupIds.includes(g.id);
              return (
                <label
                  key={g.id}
                  className={cx(
                    'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-caption',
                    on ? 'border-navy-950 bg-navy-50 text-navy-950' : 'border-line text-ink',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() =>
                      setGroupIds((x) => (on ? x.filter((y) => y !== g.id) : [...x, g.id]))
                    }
                  />
                  {g.label}
                </label>
              );
            })}
          </div>
        </div>
      </fieldset>

      <fieldset disabled={!editing} className="panel flex flex-col gap-3 p-5">
        <legend className="sr-only">{t.amounts}</legend>
        <span className="text-caption font-medium text-ink">{t.amounts}</span>
        {heads.data.map((h) => (
          <label key={h.id} className="flex items-center gap-3">
            <span className="flex-1 text-body text-ink">{h.name}</span>
            <input
              inputMode="decimal"
              aria-label={`${h.name} ${t.amount}`}
              value={amounts[h.id] ?? ''}
              onChange={(e) => setAmounts((a) => ({ ...a, [h.id]: e.target.value }))}
              className={cx(field, 'tabular w-40 text-right')}
            />
          </label>
        ))}
        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-body font-semibold text-ink">{t.total}</span>
          <span className="tabular text-lead font-semibold text-ink">{rupees(total)}</span>
        </div>
      </fieldset>

      <fieldset disabled={!editing} className="panel flex flex-col gap-3 p-5">
        <legend className="sr-only">{t.instalments}</legend>
        <span className="text-caption font-medium text-ink">{t.instalments}</span>
        {insts.map((i, n) => (
          <div key={n} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption text-ink-muted">{t.label}</span>
              <input
                required
                value={i.label}
                onChange={(e) =>
                  setInsts((x) => x.map((y, k) => (k === n ? { ...y, label: e.target.value } : y)))
                }
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption text-ink-muted">{t.dueOn}</span>
              <input
                type="date"
                required
                value={i.dueOn}
                onChange={(e) =>
                  setInsts((x) => x.map((y, k) => (k === n ? { ...y, dueOn: e.target.value } : y)))
                }
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption text-ink-muted">{t.share}</span>
              <input
                inputMode="decimal"
                required
                value={i.share}
                onChange={(e) =>
                  setInsts((x) => x.map((y, k) => (k === n ? { ...y, share: e.target.value } : y)))
                }
                className={cx(field, 'tabular w-24 text-right')}
              />
            </label>
            <Button
              size="sm"
              variant="quiet"
              aria-label={`${t.label} ${n + 1}: ${en.notices.remove}`}
              disabled={insts.length === 1}
              onClick={() => setInsts((x) => x.filter((_, k) => k !== n))}
            >
              <X aria-hidden className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setInsts((x) => [...x, { label: '', dueOn: '', share: '0' }])}
          >
            <Plus aria-hidden className="size-4" />
            {t.addInstalment}
          </Button>
          <span
            className={cx(
              'tabular text-caption',
              sharesTotal === 10_000 ? 'text-ink-muted' : 'text-signal-stop-ink',
            )}
          >
            {t.sharesTotal(percent(sharesTotal))}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-ink-muted">{t.lateFee}</span>
            <input
              inputMode="decimal"
              value={lateFee}
              onChange={(e) => setLateFee(e.target.value)}
              className={cx(field, 'tabular')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-ink-muted">{t.graceDays}</span>
            <input
              type="number"
              min={0}
              max={90}
              value={grace}
              onChange={(e) => setGrace(e.target.value)}
              className={field}
            />
          </label>
        </div>
      </fieldset>

      <div className="flex flex-wrap justify-end gap-3">
        {editing ? (
          <>
            <Button
              type="submit"
              variant="secondary"
              disabled={
                save.isPending ||
                !id ||
                sharesTotal !== 10_000 ||
                lines.length === 0 ||
                groupIds.length === 0
              }
            >
              {t.save}
            </Button>
            {p?.state === 'draft' && (
              <Button disabled={publish.isPending} onClick={() => publish.mutate()}>
                {t.publish}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t.newVersion}
            </Button>
            {p?.state === 'published' && p.invoicesIssued > 0 && (
              <Button disabled={ask.isPending} onClick={() => ask.mutate()}>
                {t.issue}
              </Button>
            )}
          </>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink"
        >
          {feeError(error)}
        </p>
      )}

      <PreviewCanvas
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title={t.issueTitle}
        actionLabel={t.issue}
        changes={t.issueChanges(rupees(preview?.totalPaise ?? 0))}
        affected={[
          { label: t.issueStudents, count: preview?.students ?? 0 },
          { label: t.issueInvoices, count: preview?.invoices ?? 0 },
          { label: t.issueAlready, count: preview?.alreadyIssued ?? 0 },
        ]}
        risks={
          preview?.increaseOverPreviousBp
            ? [t.issueRiskIncrease(percent(preview.increaseOverPreviousBp))]
            : []
        }
        undo={t.issueUndo}
        busy={issue.isPending}
        labels={en.preview}
        onConfirm={() => issue.mutate()}
      />
      <Announcer message={message} />
    </form>
  );
}
