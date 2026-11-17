'use client';

// Campus Core › Data Import (rule book §13 Campus Core, §17 P0 item 16): templates, checks, a dry
// run, commit and undo in one place, and the Campusverse V1 importers that move earlier tenants
// across with the same checks.
import { EmptyState, PageHeader, Section, SkeletonRows, StatePanel } from '@campusverse/ui';
import { Upload } from 'lucide-react';
import Link from 'next/link';
import { ApiFailure } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { ImportsStep } from '../setup/imports-step';
import { useOverview } from '../setup/shared';

const t = en.dataImport;

export function DataImportView() {
  const school = useInstitution();
  const id = school.institutionId ?? '';
  const isSchool = !school.profile || school.profile === 'school';
  const overview = useOverview(id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Upload}
        area="navy"
        eyebrow={en.systems.groups.core}
        title={t.title}
        description={t.lead}
      />
      {!id || overview.isPending ? (
        <SkeletonRows rows={6} label={en.states.loading.title} />
      ) : overview.isError ? (
        overview.error instanceof ApiFailure && overview.error.status === 403 ? (
          <StatePanel kind="denied" title={en.states.denied.title} />
        ) : (
          <StatePanel kind="error" title={en.states.error.title} />
        )
      ) : (
        <>
          <ol className="grid gap-3 md:grid-cols-3">
            {(isSchool ? t.steps : t.collegeSteps).map((step, i) => (
              <li key={step} className="panel flex gap-3 p-4">
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-950 text-caption font-semibold text-white"
                >
                  {i + 1}
                </span>
                <span className="text-body text-ink">{step}</span>
              </li>
            ))}
          </ol>
          <ImportsStep
            institutionId={id}
            overview={overview.data}
            allowV1
            kinds={isSchool ? ['staff', 'students'] : ['staff']}
          />
          {!isSchool && (
            <Section>
              <EmptyState
                icon={Upload}
                area="navy"
                title={t.collegeTitle}
                body={t.collegeBody}
                actions={
                  <Link
                    href="/academic-structure"
                    className="inline-flex h-10 items-center rounded-lg bg-navy-950 px-4 text-body font-medium text-white hover:bg-navy-950/90"
                  >
                    {t.openStructure}
                  </Link>
                }
              />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
