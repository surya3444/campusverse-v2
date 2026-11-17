'use client';

import { PageHeader, StatePanel, cx } from '@campusverse/ui';
import { Check, ClipboardCheck } from 'lucide-react';
import { useState } from 'react';
import { en } from '../../../messages/en';
import { ImportsStep } from './imports-step';
import { InvitesStep, ReadyStep } from './invites-ready';
import { useInstitution } from '../attendance/shared';
import { failureText, useOverview, useReadiness } from './shared';
import { StructureStep } from './structure-step';

const t = en.setup;
type Step = keyof typeof t.steps;
const STEPS = Object.keys(t.steps) as Step[];

export function SetupWizard() {
  return <Wizard />;
}

function Wizard() {
  // The institution chosen in the scope switcher (each school is set up on its own).
  const institutions = useInstitution();
  const id = institutions.institutionId;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ClipboardCheck}
        art="setup"
        eyebrow={en.nav.groups.school}
        area="teal"
        title={t.title}
        description={t.intro}
      />
      {institutions.isPending ? (
        <StatePanel kind="loading" title={en.states.loading.title} />
      ) : institutions.isError ? (
        <StatePanel
          kind="error"
          title={failureText(institutions.error)}
          action={en.home.retry}
          onAction={() => void institutions.refetch()}
        />
      ) : !id ? (
        <StatePanel kind="empty" title={t.noSchool} />
      ) : (
        <Steps institutionId={id} />
      )}
    </div>
  );
}

function Steps({ institutionId }: { institutionId: string }) {
  const overview = useOverview(institutionId);
  const readiness = useReadiness(institutionId);
  const ok = (key: string) => readiness.data?.checks.find((c) => c.key === key)?.ok ?? false;
  const done: Record<Step, boolean> = {
    structure: !!overview.data?.year && (overview.data?.classes.length ?? 0) > 0,
    imports: ok('students') && ok('class_teachers'),
    invites: ok('teacher_logins'),
    ready: readiness.data?.ready ?? false,
  };
  const [chosen, setChosen] = useState<Step | null>(null);
  const current = chosen ?? STEPS.find((s) => !done[s]) ?? 'ready';

  if (overview.isPending || readiness.isPending)
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (overview.isError) {
    return (
      <StatePanel
        kind="error"
        title={failureText(overview.error)}
        action={en.home.retry}
        onAction={() => void overview.refetch()}
      />
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label={t.title} className="panel p-2">
        <ol className="flex flex-col gap-0.5">
          {STEPS.map((step, i) => (
            <li key={step}>
              <button
                type="button"
                onClick={() => setChosen(step)}
                aria-current={current === step ? 'step' : undefined}
                className={cx(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left',
                  current === step ? 'bg-navy-50' : 'hover:bg-paper',
                )}
              >
                <span
                  className={cx(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-medium',
                    done[step]
                      ? 'bg-signal-go-tint text-signal-go-ink'
                      : 'border border-line-strong text-ink-muted',
                  )}
                >
                  {done[step] ? <Check aria-hidden className="size-3.5" /> : i + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cx(
                      'text-body',
                      current === step ? 'font-medium text-navy-950' : 'text-ink',
                    )}
                  >
                    {t.steps[step]}
                  </span>
                  <span className="text-caption text-ink-muted">
                    {done[step] ? t.done : t.todo}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0">
        {current === 'structure' && (
          <StructureStep institutionId={institutionId} overview={overview.data} />
        )}
        {current === 'imports' && (
          <ImportsStep institutionId={institutionId} overview={overview.data} />
        )}
        {current === 'invites' && <InvitesStep institutionId={institutionId} />}
        {current === 'ready' && readiness.data && <ReadyStep readiness={readiness.data} />}
      </div>
    </div>
  );
}
