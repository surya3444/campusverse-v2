'use client';

import type { GrantRow, Staff } from '@campusverse/platform-control';
import { Button, PageHeader } from '@campusverse/ui';
import { LifeBuoy } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { at, Chip, Loaded, Notice } from '../../../lib/ui';
import { en } from '../../../messages/en';

const t = en.support;

export default function SupportPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Staff>('/me') });
  const list = useQuery({ queryKey: ['grants'], queryFn: () => api.get<GrantRow[]>('/support') });
  const end = useMutation({
    mutationFn: (id: string) => api.post(`/support/${id}/end`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['grants'] }),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={LifeBuoy} area="sky" title={t.title} />
      <Notice error={end.error} />
      <Loaded q={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <ul className="panel divide-y divide-line">
            {rows.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink">
                    {g.staff} ·{' '}
                    <Link href={`/customers/${g.orgId}`} className="text-navy-950 underline">
                      {g.customer}
                    </Link>
                  </span>
                  <span className="text-caption text-ink-muted">
                    {g.reason} · {at(g.startsAt)} {t.until(at(g.expiresAt))}
                  </span>
                </span>
                <Chip tone={g.active ? 'active' : 'closed'}>{g.active ? t.active : t.ended}</Chip>
                {g.active && (me.data?.role === 'owner' || me.data?.staffId === g.staffId) && (
                  <Button size="sm" variant="secondary" onClick={() => end.mutate(g.id)}>
                    {t.end}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </div>
  );
}
