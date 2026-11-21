'use client';

// How the student was admitted (owner's brief, 20 Nov 2026): the application's reference, its
// dates and who verified it. Everything else the family told the school is already on this record.
import type { StudentAdmission } from '@campusverse/school-admissions';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useMe } from '../../common/me';
import { InfoGrid, ProfilePanel } from '../../common/profile360';

const a = en.admissionsCrm.studentCard;
const day = (ts: string | null) =>
  ts
    ? new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(ts))
    : null;

export function AdmissionPanel({ studentId }: { studentId: string }) {
  const { can } = useMe();
  const q = useQuery({
    queryKey: ['student-admission', studentId],
    queryFn: () =>
      api.get<{ admission: StudentAdmission | null }>(`/school/admissions/students/${studentId}`),
    retry: false,
  });
  const x = q.data?.admission;
  if (!x) return null;
  return (
    <ProfilePanel
      title={a.title}
      icon={UserPlus}
      description={a.lead}
      action={
        can('school.admission.manage') ? (
          <Link
            href={`/admissions/${x.applicationId}`}
            className="inline-flex items-center gap-1 text-body font-medium text-navy-950 hover:underline"
          >
            {a.open}
            <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        ) : undefined
      }
    >
      <InfoGrid
        items={[
          { label: a.reference, value: x.reference ?? '—' },
          { label: a.yearClass, value: `${x.yearLabel} · ${x.className}` },
          {
            label: a.came,
            value: [
              x.viaForm ? a.viaForm : (en.admissions.sources[x.source] ?? x.source),
              x.campaign,
            ]
              .filter(Boolean)
              .join(' · '),
          },
          { label: a.enquired, value: day(x.enquiredOn) },
          { label: a.applied, value: day(x.appliedOn) },
          {
            label: a.verified,
            value: x.verifiedOn
              ? `${day(x.verifiedOn)}${x.verifiedBy ? ` · ${x.verifiedBy}` : ''}`
              : null,
          },
          { label: a.offered, value: day(x.offeredOn) },
          { label: a.accepted, value: day(x.confirmedOn) },
          { label: a.enrolled, value: day(x.enrolledOn) },
          { label: a.papers, value: a.papersN(x.papers) },
        ]}
      />
    </ProfilePanel>
  );
}
