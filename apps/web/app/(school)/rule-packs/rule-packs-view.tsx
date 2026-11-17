'use client';

// Campus Core › Rule Packs (rule book §15.1, §12.4 decision 11): the packs this institution
// follows, what each version sets and where it comes from, and switching to a new version from a
// date. Versions are released by Campusverse after review and test cases.
import type { InstitutionPack } from '@campusverse/platform-rulepacks';
import type { BoardPack, CreditsPack, LabourPack, Source, StatePack } from '@campusverse/rules';
import {
  Button,
  FormModal,
  ModalField,
  PageHeader,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Gavel, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';

const t = en.rulePacks;
const s = t.summary;
const date = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${d.slice(0, 10)}T00:00:00`),
  );
const pct = (bp: number) => bp / 100;
const MONTHS = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

/** What a version sets, in plain words, by kind of pack. */
function summary(kind: string, payload: unknown): string[] {
  if (kind === 'board') {
    const p = payload as BoardPack;
    return [
      p.attendance
        ? s.attendance(pct(p.attendance.minimumBasisPoints), pct(p.attendance.warnBelowBasisPoints))
        : null,
      p.grades
        ? s.grading(
            `${p.grades.bands[0]?.grade} from ${pct(p.grades.bands[0]?.minBasisPoints ?? 0)}%`,
            pct(p.grades.passBasisPoints),
          )
        : s.noGrading,
      p.promotion.boardClasses.length ? s.boardYears(p.promotion.boardClasses.join(', ')) : null,
      p.promotion.passMarkClasses.length
        ? s.passMarks(p.promotion.passMarkClasses.join(', '))
        : null,
    ].filter((x): x is string => !!x);
  }
  if (kind === 'state') {
    const p = payload as StatePack;
    const pt = !p.pt
      ? [s.noPt]
      : p.pt.period === 'half_year'
        ? [s.ptHalfYear(p.pt.slabs.length)]
        : p.pt.slabs.map((x) => s.pt(rupees(x.amountPaise), rupees(x.fromPaise)));
    return [
      ...pt,
      ...(p.pt?.month
        ? [s.ptSpecial(MONTHS[p.pt.month.month] ?? '', rupees(p.pt.month.amountPaise))]
        : []),
      ...(p.tcDeadlineDays ? [s.tc(p.tcDeadlineDays)] : []),
    ];
  }
  if (kind === 'labour') {
    const p = payload as LabourPack;
    return [
      s.pf(pct(p.pf.rateBp), rupees(p.pf.wageCeilingPaise), pct(p.pf.epsBp)),
      s.esi(pct(p.esi.employeeBp), pct(p.esi.employerBp), rupees(p.esi.grossLimitPaise)),
    ];
  }
  const p = payload as CreditsPack;
  return Object.values(p.frameworks).map((f) => s.framework(f.title, f.totalCredits));
}

function Sources({ sources }: { sources: Source[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {sources.map((src) => (
        <li key={src.title} className="flex flex-wrap items-center gap-2 text-caption text-ink">
          {src.url ? (
            <a
              href={src.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-navy-950 underline underline-offset-2"
            >
              {src.title}
              <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : (
            <span>{src.title}</span>
          )}
          <Pill tone={src.verified ? 'go' : 'warn'}>
            {src.verified ? t.verified : t.unverified}
          </Pill>
        </li>
      ))}
    </ul>
  );
}

export function RulePacksView() {
  const school = useInstitution();
  const id = school.institutionId;
  const canAdopt = useMe().can('platform.rules.adopt');
  const [switching, setSwitching] = useState<{
    pack: InstitutionPack;
    version: number;
    effectiveFrom: string;
  } | null>(null);
  const q = useQuery({
    queryKey: ['rule-packs', id],
    queryFn: () => api.get<InstitutionPack[]>(`/rule-packs?institutionId=${id}`),
    enabled: !!id,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Gavel}
        area="navy"
        eyebrow={en.systems.groups.core}
        title={t.title}
        description={t.lead}
      />
      {q.error ? (
        q.error instanceof ApiFailure && q.error.status === 403 ? (
          <StatePanel
            kind="denied"
            title={en.states.denied.title}
            body={t.errors.forbidden ?? ''}
          />
        ) : typeof navigator !== 'undefined' && !navigator.onLine ? (
          <StatePanel
            kind="offline"
            title={en.states.offline.title}
            body={en.states.offline.body}
          />
        ) : (
          <StatePanel kind="error" title={t.errors.error ?? ''} />
        )
      ) : !q.data ? (
        <SkeletonRows rows={6} label={en.states.loading.title} />
      ) : (
        q.data.map((p) => (
          <Section
            key={p.pack}
            id={`pack-${p.pack.replace('.', '-')}`}
            title={p.title}
            description={t.kinds[p.kind]}
          >
            <div className="flex flex-col gap-4">
              <p className="flex flex-wrap items-center gap-2 text-body text-ink">
                <span className="font-semibold">{t.inUse(p.inUse.version)}</span>
                {p.inUse.builtin && <Pill>{t.builtIn}</Pill>}
                <span className="text-caption text-ink-muted">
                  {t.since(date(p.inUse.effectiveFrom))}
                  {p.inUse.fromDate && !p.inUse.builtin
                    ? ` · ${t.followingSince(date(p.inUse.fromDate))}`
                    : ''}
                </span>
              </p>
              {p.scheduled && (
                <p className="text-caption text-ink">
                  <Pill tone="neutral">
                    {t.scheduled(p.scheduled.version, date(p.scheduled.fromDate))}
                  </Pill>
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-1.5 text-caption font-semibold tracking-wide text-ink-muted uppercase">
                    {t.sets}
                  </h3>
                  <ul className="flex flex-col gap-1 text-body text-ink">
                    {summary(p.kind, p.inUse.payload).map((line) => (
                      <li key={line} className="flex gap-2">
                        <span
                          aria-hidden
                          className="mt-2 size-1.5 shrink-0 rounded-full bg-navy-200"
                        />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1.5 text-caption font-semibold tracking-wide text-ink-muted uppercase">
                    {t.sources}
                  </h3>
                  <Sources sources={p.inUse.sources} />
                </div>
              </div>
              {/* The newest released version; older ones it supersedes aren't offered. */}
              {p.available.slice(-1).map((v) => (
                <div
                  key={v.version}
                  className="flex flex-col gap-2 rounded-lg border border-navy-100 bg-navy-50/50 p-4"
                >
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                    <Sparkles aria-hidden className="size-4 text-navy-950" />
                    {t.newVersion(v.version)}
                    <span className="text-caption font-normal text-ink-muted">
                      {t.effective(date(v.effectiveFrom))} · {t.tests(v.tests)}
                    </span>
                  </p>
                  <p className="text-body text-ink">{v.notes}</p>
                  <Sources sources={v.sources} />
                  {canAdopt && (
                    <Button
                      size="md"
                      className="self-start"
                      aria-label={t.switchFor(p.title, v.version)}
                      onClick={() =>
                        setSwitching({
                          pack: p,
                          version: v.version,
                          effectiveFrom: v.effectiveFrom,
                        })
                      }
                    >
                      {t.switchOn}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Section>
        ))
      )}
      {switching && id && (
        <SwitchForm institutionId={id} {...switching} onClose={() => setSwitching(null)} />
      )}
    </div>
  );
}

function SwitchForm({
  institutionId,
  pack,
  version,
  effectiveFrom,
  onClose,
}: {
  institutionId: string;
  pack: InstitutionPack;
  version: number;
  effectiveFrom: string;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(effectiveFrom.slice(0, 10));
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      api.post('/rule-packs/adopt', { institutionId, pack: pack.pack, version, fromDate: from }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rule-packs', institutionId] });
      onClose();
    },
  });
  const title = t.switchFor(pack.title, version);
  return (
    <FormModal
      title={title}
      description={t.switchLead}
      submitLabel={t.switchOn}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={!from || from < effectiveFrom.slice(0, 10)}
      error={m.isError ? errorText(m.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={t.from} hint={t.effective(date(effectiveFrom))} wide>
        <input
          type="date"
          required
          min={effectiveFrom.slice(0, 10)}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}
