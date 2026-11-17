'use client';

import { PageHeader } from '@campusverse/ui';
import { ScrollText } from 'lucide-react';
import type { AuditRow } from '@campusverse/platform-control';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { at, Field, Loaded, field } from '../../../lib/ui';
import { en } from '../../../messages/en';

const t = en.audit;

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = new URLSearchParams(
    Object.entries({ action, from, to }).filter(([, v]) => v) as [string, string][],
  ).toString();
  const list = useQuery({
    queryKey: ['audit', query],
    queryFn: () => api.get<AuditRow[]>(`/audit${query ? `?${query}` : ''}`),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={ScrollText} area="navy" title={t.title} />
      <div className="panel grid gap-3 p-5 sm:grid-cols-3">
        <Field label={t.action}>
          <input
            value={action}
            onChange={(e) => setAction(e.target.value.toLowerCase().replace(/[^a-z_.]/g, ''))}
            className={field}
          />
        </Field>
        <Field label={t.from}>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={field}
          />
        </Field>
        <Field label={t.to}>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
        </Field>
      </div>
      <Loaded q={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <ul className="panel divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3 gap-y-1 px-5 py-2.5 text-caption">
                <span className="text-ink-muted tabular-nums">{at(r.at)}</span>
                <span className="font-medium text-ink">{r.action}</span>
                <span className="text-ink-muted">{r.staff ?? t.system}</span>
                {r.orgId && (
                  <Link href={`/customers/${r.orgId}`} className="text-navy-950 underline">
                    {r.customer}
                  </Link>
                )}
                {r.reason && <span className="text-ink-muted">· {r.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </div>
  );
}
