'use client';

// Quality & Compliance › Government Reports (rule book §13.11): UDISE+ readiness for the school,
// with what is missing per student and an audited export of the working list.
import type { UdiseReadiness, UdiseRow } from '@campusverse/school-returns';
import {
  Announcer,
  Button,
  EmptyState,
  KeyFigures,
  PageHeader,
  Pill,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, FileWarning, Landmark, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { exportCsv } from '../../../lib/csv';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { AbcNad } from './abc-nad';
import { ApaarSync } from './apaar-sync';

const t = en.returns;
const dash = '—';
const date = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(`${d}T00:00:00`),
  );

export function ReturnsView() {
  const school = useInstitution();
  const id = school.institutionId;
  const [message, setMessage] = useState<string | null>(null);
  // Colleges and universities report credits to ABC and NAD; UDISE+ and APAAR are for schools.
  const higherEd = !!school.profile && school.profile !== 'school';
  const [view, setView] = useState<'incomplete' | 'all'>('incomplete');
  const q = useQuery({
    queryKey: ['udise', id],
    queryFn: () => api.get<UdiseReadiness>(`/returns/udise?institutionId=${id}`),
    enabled: !!id && !higherEd,
  });
  const d = q.data;
  const rows = d ? (view === 'all' ? d.rows : d.rows.filter((r) => r.missing.length > 0)) : [];
  const details = d ? d.missing.gender + d.missing.date_of_birth + d.missing.parent_name : 0;
  const denied = q.error instanceof ApiFailure && q.error.status === 403;

  const download = () => {
    if (!d || !id) return;
    void exportCsv(
      'udise_students',
      id,
      t.exportName,
      t.exportHeader,
      d.rows.map((r) => [
        r.admissionNumber ?? '',
        r.name,
        r.classLabel ?? '',
        r.gender ? (t.genders[r.gender] ?? r.gender) : '',
        r.dateOfBirth ?? '',
        r.father ?? '',
        r.mother ?? '',
        r.guardian ?? '',
        r.pen ?? '',
        t.apaar[r.apaarStatus] ?? r.apaarStatus,
        r.missing.map((m) => t.missing[m] ?? m).join('; '),
      ]),
    );
  };

  if (higherEd && id)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={Landmark}
          area="navy"
          eyebrow={en.systems.groups.quality}
          title={t.title}
          description={en.abcNad.lead}
        />
        <AbcNad institutionId={id} />
      </div>
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Landmark}
        area="navy"
        eyebrow={en.systems.groups.quality}
        title={t.title}
        description={t.lead}
        actions={
          d && d.students > 0 ? (
            <Button variant="secondary" onClick={download}>
              <Download aria-hidden />
              {t.export}
            </Button>
          ) : undefined
        }
      />
      {denied ? (
        <StatePanel kind="denied" title={en.states.denied.title} body={t.errors.forbidden ?? ''} />
      ) : q.error ? (
        typeof navigator !== 'undefined' && !navigator.onLine ? (
          <StatePanel
            kind="offline"
            title={en.states.offline.title}
            body={en.states.offline.body}
          />
        ) : (
          <StatePanel kind="error" title={t.errors.error ?? ''} />
        )
      ) : (
        <>
          <KeyFigures
            label={t.figures}
            loading={!d}
            figures={[
              { label: t.fig.students, icon: Users, value: String(d?.students ?? '–') },
              { label: t.fig.ready, icon: CheckCircle2, value: String(d?.ready ?? '–') },
              {
                label: t.fig.pen,
                icon: FileWarning,
                value: String(d?.missing.pen ?? '–'),
                ...(d?.missing.pen ? { tone: 'warn' as const } : {}),
              },
              {
                label: t.fig.details,
                icon: FileWarning,
                value: String(d ? details : '–'),
                ...(details ? { tone: 'warn' as const } : {}),
              },
            ]}
          />
          {!d ? (
            <SkeletonRows rows={6} label={en.states.loading.title} />
          ) : d.students === 0 ? (
            <EmptyState icon={Landmark} area="navy" title={t.empty} />
          ) : (
            <Section
              id="udise"
              title={t.udise}
              description={t.udiseLead}
              actions={
                <Segmented
                  label={t.view}
                  value={view}
                  onChange={setView}
                  options={(['incomplete', 'all'] as const).map((v) => ({
                    value: v,
                    label: t.views[v],
                  }))}
                />
              }
              flush
            >
              {rows.length === 0 ? (
                <p className="flex items-center gap-2 px-6 pb-5 text-body text-ink">
                  <CheckCircle2 aria-hidden className="size-4 text-signal-go" />
                  {t.allReady}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <UdiseTable rows={rows} />
                </div>
              )}
            </Section>
          )}
          {id && d && d.students > 0 && <ApaarSync institutionId={id} onMessage={setMessage} />}
          <p className="text-caption text-ink-muted">{t.formatNote}</p>
        </>
      )}
      <Announcer message={message} />
    </div>
  );
}

function UdiseTable({ rows }: { rows: UdiseRow[] }) {
  const c = t.table;
  return (
    <table className="w-full min-w-[980px] text-body">
      <caption className="sr-only">{t.udise}</caption>
      <thead>
        <tr className="border-y border-line bg-paper text-left text-caption tracking-wide whitespace-nowrap text-ink-muted uppercase">
          <th scope="col" className="px-5 py-2 font-medium">
            {c.student}
          </th>
          <th scope="col" className="px-5 py-2 font-medium">
            {c.klass}
          </th>
          <th scope="col" className="px-5 py-2 font-medium">
            {c.gender}
          </th>
          <th scope="col" className="px-5 py-2 font-medium">
            {c.dob}
          </th>
          <th scope="col" className="px-5 py-2 font-medium">
            {c.parent}
          </th>
          <th scope="col" className="px-5 py-2 font-medium">
            {c.pen}
          </th>
          <th scope="col" className="px-5 py-2 font-medium">
            {c.apaar}
          </th>
          <th scope="col" className="px-5 py-2 font-medium">
            {c.missing}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={r.personId}>
            <th scope="row" className="px-5 py-3 text-left font-normal">
              <Link
                href={`/students/${r.personId}`}
                className="font-medium text-navy-950 underline-offset-2 hover:underline"
              >
                {r.name}
              </Link>
              {r.admissionNumber && (
                <span className="block text-caption text-ink-muted">{r.admissionNumber}</span>
              )}
            </th>
            <td className="px-5 py-3 whitespace-nowrap text-ink">{r.classLabel ?? dash}</td>
            <td className="px-5 py-3 text-ink">
              {r.gender ? (t.genders[r.gender] ?? r.gender) : dash}
            </td>
            <td className="tabular px-5 py-3 whitespace-nowrap text-ink">
              {r.dateOfBirth ? date(r.dateOfBirth) : dash}
            </td>
            <td className="px-5 py-3 text-ink">{r.father ?? r.mother ?? r.guardian ?? dash}</td>
            <td className="tabular px-5 py-3 text-ink">{r.pen ?? dash}</td>
            <td className="px-5 py-3 text-ink">{t.apaar[r.apaarStatus] ?? r.apaarStatus}</td>
            <td className="px-5 py-3">
              {r.missing.length === 0 ? (
                <Pill tone="go">{t.fig.ready}</Pill>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {r.missing.map((m) => (
                    <Pill key={m} tone="warn">
                      {t.missing[m] ?? m}
                    </Pill>
                  ))}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
