'use client';

import type { ApprovalRow, Staff } from '@campusverse/platform-control';
import { Button, PageHeader } from '@campusverse/ui';
import { CheckCheck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { at, Chip, Loaded, Notice } from '../../../lib/ui';
import { en } from '../../../messages/en';

const t = en.approvals;

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Staff>('/me') });
  const list = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api.get<ApprovalRow[]>('/approvals'),
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) =>
      api.post(`/approvals/${v.id}/decide`, { approve: v.approve }),
    onSuccess: () => void qc.invalidateQueries(),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={CheckCheck} area="go" title={t.title} />
      <Notice error={decide.error} />
      <Loaded q={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <ul className="panel divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink">
                    {t.kinds[a.kind]} {t.detail(a.payload)} ·{' '}
                    <Link href={`/customers/${a.orgId}`} className="text-navy-950 underline">
                      {a.customer}
                    </Link>
                  </span>
                  <span className="text-caption text-ink-muted">
                    {a.reason} · {t.askedBy(a.requestedBy)} · {at(a.createdAt)}
                    {a.decidedBy && ` · ${t.decidedBy(a.decidedBy)}`}
                  </span>
                </span>
                {a.state === 'requested' &&
                me.data?.role === 'owner' &&
                a.requestedById !== me.data.staffId ? (
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: a.id, approve: false })}
                    >
                      {t.reject}
                    </Button>
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: a.id, approve: true })}
                    >
                      {t.approve}
                    </Button>
                  </span>
                ) : (
                  <Chip tone={a.state}>{t.states[a.state]}</Chip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </div>
  );
}
