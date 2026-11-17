'use client';

import type { DeliveryHealth } from '@campusverse/platform-control';
import { KeyFigures, PageHeader } from '@campusverse/ui';
import { Activity } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { Loaded } from '../../../lib/ui';
import { en } from '../../../messages/en';

const t = en.health;

export default function HealthPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<DeliveryHealth>('/health'),
    refetchInterval: 30_000,
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={Activity} area="teal" title={t.title} />
      <Loaded q={health}>
        {(h) => (
          <>
            <KeyFigures
              label={t.title}
              figures={[
                {
                  label: t.backlog,
                  value: String(h.outbox.waiting),
                  tone: h.outbox.waiting > 100 ? 'warn' : 'neutral',
                },
                {
                  label: t.oldest,
                  value: t.seconds(h.outbox.oldestSeconds),
                  tone: (h.outbox.oldestSeconds ?? 0) > 300 ? 'stop' : 'neutral',
                },
              ]}
            />
            {h.customers.length === 0 ? (
              <p className="text-body text-ink-muted">{t.none}</p>
            ) : (
              <div
                tabIndex={0}
                role="region"
                aria-label={t.title}
                className="panel overflow-x-auto"
              >
                <table className="w-full text-body">
                  <thead>
                    <tr className="text-left text-caption text-ink-muted">
                      <th className="px-5 py-2 font-medium">{en.nav.customers}</th>
                      <th className="px-3 py-2 font-medium">{t.channel}</th>
                      <th className="px-3 py-2 text-right font-medium">{t.sent}</th>
                      <th className="px-3 py-2 text-right font-medium">{t.delivered}</th>
                      <th className="px-5 py-2 text-right font-medium">{t.failed}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line tabular-nums">
                    {h.customers.flatMap((c) =>
                      c.channels.map((ch, i) => (
                        <tr key={`${c.orgId}-${ch.channel}`}>
                          <td className="px-5 py-2">
                            {i === 0 && (
                              <Link
                                href={`/customers/${c.orgId}`}
                                className="text-navy-950 underline"
                              >
                                {c.customer}
                              </Link>
                            )}
                          </td>
                          <td className="px-3 py-2">{ch.channel}</td>
                          <td className="px-3 py-2 text-right">{ch.sent}</td>
                          <td className="px-3 py-2 text-right">{ch.delivered}</td>
                          <td
                            className={`px-5 py-2 text-right ${ch.failed > 0 ? 'font-medium text-signal-stop-ink' : ''}`}
                          >
                            {ch.failed}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}
