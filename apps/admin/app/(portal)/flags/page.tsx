'use client';

import type { FlagRow, Staff } from '@campusverse/platform-control';
import { Button, PageHeader } from '@campusverse/ui';
import { Flag } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { Chip, Loaded, Notice, Panel } from '../../../lib/ui';
import { en } from '../../../messages/en';

const t = en.flags;

export default function FlagsPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Staff>('/me') });
  const list = useQuery({ queryKey: ['flags'], queryFn: () => api.get<FlagRow[]>('/flags') });
  const setDefault = useMutation({
    mutationFn: (v: { key: string; defaultOn: boolean }) => api.post('/flags/default', v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['flags'] }),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={Flag} area="violet" title={t.title} description={t.lead} />
      <Notice error={setDefault.error} />
      <Loaded q={list} empty={(d) => d.length === 0}>
        {(rows) =>
          rows.map((f) => (
            <Panel key={f.key} title={f.key}>
              <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="flex-1 text-body text-ink">{f.description}</span>
                <Chip tone={f.defaultOn ? 'active' : 'closed'}>{t.default(f.defaultOn)}</Chip>
                {me.data?.role === 'owner' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDefault.mutate({ key: f.key, defaultOn: !f.defaultOn })}
                  >
                    {f.defaultOn ? t.turnDefaultOff : t.turnDefaultOn}
                  </Button>
                )}
              </div>
              <ul className="border-t border-line px-5 py-3 text-caption">
                {f.overrides.length === 0 ? (
                  <li className="text-ink-muted">{t.noOverrides}</li>
                ) : (
                  f.overrides.map((o) => (
                    <li key={o.orgId}>
                      <Link href={`/customers/${o.orgId}`} className="text-navy-950 underline">
                        {o.customer}
                      </Link>{' '}
                      · {o.enabled ? en.customers.on : en.customers.off}
                    </li>
                  ))
                )}
              </ul>
            </Panel>
          ))
        }
      </Loaded>
    </div>
  );
}
