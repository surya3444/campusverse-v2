'use client';

import { STATES } from '@campusverse/rules';
import { Button, IconTile, Progress, StatePanel, cx, type Area } from '@campusverse/ui';
import iconColor from '@campusverse/ui/brand/icon-color.svg';
import {
  Building2,
  Check,
  ClipboardList,
  MapPin,
  Plus,
  School as SchoolIcon,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiFailure, session } from '../../lib/api';
import { en } from '../../messages/en';

const t = en.onboarding;
const STEPS = ['profile', 'organisation', 'campuses', 'institutions', 'review'] as const;
const STEP_ICON: Record<(typeof STEPS)[number], [LucideIcon, Area]> = {
  profile: [UserRound, 'sky'],
  organisation: [Building2, 'navy'],
  campuses: [MapPin, 'teal'],
  institutions: [SchoolIcon, 'violet'],
  review: [ClipboardList, 'go'],
};
type Step = (typeof STEPS)[number];
const CLASSES = [
  'Nursery',
  'LKG',
  'UKG',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
];
const field =
  'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';

type Kind = 'school' | 'college' | 'university';
type School = {
  /** What it is (rule book §12.3): a school, a college (affiliated or autonomous) or a university. */
  kind?: Kind;
  collegeProfile?: 'affiliated_college' | 'autonomous_college';
  /** A college's affiliating university, or a university's regulator (e.g. VTU, UGC). */
  authority?: string;
  name: string;
  udiseCode: string;
  affiliationNumber: string;
  establishedYear: string;
  medium: string;
  lowestClass: string;
  highestClass: string;
  phone: string;
  email: string;
  website: string;
};
type Campus = {
  name: string;
  addressLine: string;
  city: string;
  district: string;
  stateCode: string;
  pincode: string;
  schools: School[];
};
type Draft = {
  step: Step;
  admin: { name: string; designation: string; email: string };
  organisation: { name: string; legalEntityName: string; gstin: string };
  campuses: Campus[];
};

const newSchool = (): School => ({
  name: '',
  udiseCode: '',
  affiliationNumber: '',
  establishedYear: '',
  medium: 'English',
  lowestClass: 'LKG',
  highestClass: '10',
  phone: '',
  email: '',
  website: '',
});
const newCampus = (name = ''): Campus => ({
  name,
  addressLine: '',
  city: '',
  district: '',
  stateCode: 'KA',
  pincode: '',
  schools: [newSchool()],
});

type State = {
  name: string;
  email: string | null;
  phone: string;
  planName: string;
  draft: Partial<Draft>;
};

async function load(): Promise<State> {
  const res = await fetch('/session/onboarding', { cache: 'no-store' });
  const body = (await res.json()) as State & { code?: string };
  if (!res.ok) throw new ApiFailure(res.status, body.code ?? 'error', 'onboarding');
  return body;
}

export function OnboardingWizard() {
  const [state, setState] = useState<State | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    load()
      .then(setState)
      .catch((e: unknown) => {
        if (e instanceof ApiFailure && e.status === 401)
          window.location.assign('/login?next=/onboarding');
        else setFailure(e instanceof ApiFailure ? e.code : 'error');
      });
  }, []);
  if (failure)
    return (
      <Frame>
        <StatePanel kind="error" title={t.errors[failure] ?? t.errors.error ?? ''} />
      </Frame>
    );
  if (!state)
    return (
      <Frame>
        <StatePanel kind="loading" title={en.states.loading.title} />
      </Frame>
    );
  return <Wizard state={state} />;
}

function Frame({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8 lg:flex-row lg:gap-10 lg:py-12"
    >
      <aside className="flex flex-col gap-6 lg:sticky lg:top-12 lg:w-64 lg:shrink-0 lg:self-start">
        <div className="flex items-center gap-2">
          <Image src={iconColor} alt="" width={28} height={28} />
          <span className="text-lead font-semibold text-navy-950">{en.app.name}</span>
        </div>
        {aside}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-5">{children}</div>
    </main>
  );
}

function Wizard({ state }: { state: State }) {
  const [d, setD] = useState<Draft>(() => ({
    step: state.draft.step ?? 'profile',
    admin: state.draft.admin ?? { name: state.name, designation: '', email: state.email ?? '' },
    organisation: state.draft.organisation ?? { name: '', legalEntityName: '', gstin: '' },
    campuses: state.draft.campuses ?? [newCampus('Main campus')],
  }));
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const index = STEPS.indexOf(d.step);

  const save = async (next: Draft) => {
    setSaving('saving');
    try {
      await session.post('onboarding/draft', { draft: next });
      setSaving('saved');
    } catch {
      setSaving('idle');
    }
  };
  const go = (step: Step) => {
    const next = { ...d, step };
    setD(next);
    setError(null);
    void save(next);
    window.scrollTo({ top: 0 });
  };
  const forward = () => {
    if (form.current && !form.current.reportValidity()) return setError(t.required);
    const nextStep = STEPS[index + 1];
    if (nextStep) go(nextStep);
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setCampus = (i: number, patch: Partial<Campus>) =>
    set(
      'campuses',
      d.campuses.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    );
  const setSchool = (ci: number, si: number, patch: Partial<School>) =>
    setCampus(ci, {
      schools: (d.campuses[ci]?.schools ?? []).map((s, j) => (j === si ? { ...s, ...patch } : s)),
    });

  const create = async () => {
    setBusy(true);
    setError(null);
    const opt = (v: string) => v.trim() || null;
    try {
      await session.post('onboarding/complete', {
        admin: { name: d.admin.name, designation: d.admin.designation, email: opt(d.admin.email) },
        organisation: {
          name: d.organisation.name,
          legalEntityName: d.organisation.legalEntityName || d.organisation.name,
          gstin: opt(d.organisation.gstin.toUpperCase()),
        },
        campuses: d.campuses.map((c) => ({
          name: c.name,
          stateCode: c.stateCode,
          addressLine: opt(c.addressLine),
          city: opt(c.city),
          district: opt(c.district),
          pincode: opt(c.pincode),
          institutions: c.schools.map((s) => {
            const kind = s.kind ?? 'school';
            const school = kind === 'school';
            return {
              type: kind,
              profile: kind === 'college' ? (s.collegeProfile ?? 'affiliated_college') : kind,
              authorityCode: school ? 'CBSE' : (s.authority ?? '').trim().toUpperCase() || 'UGC',
              stateCode: c.stateCode,
              name: s.name,
              udiseCode: school ? opt(s.udiseCode) : null,
              affiliationNumber: opt(s.affiliationNumber),
              establishedYear: s.establishedYear ? Number(s.establishedYear) : null,
              medium: school ? opt(s.medium) : null,
              lowestClass: school ? opt(s.lowestClass) : null,
              highestClass: school ? opt(s.highestClass) : null,
              phone: opt(s.phone.replace(/\s/g, '')),
              email: opt(s.email),
              website: opt(s.website),
            };
          }),
        })),
      });
      // Schools set up classes next; colleges and universities start with programmes and batches.
      const anySchool = d.campuses.some((c) =>
        c.schools.some((s) => (s.kind ?? 'school') === 'school'),
      );
      window.location.assign(anySchool ? '/setup' : '/academic-structure');
    } catch (e) {
      const code = e instanceof ApiFailure ? e.code : 'error';
      setError(t.errors[code] ?? t.errors.error ?? '');
      setBusy(false);
    }
  };

  const [StepIcon, stepArea] = STEP_ICON[d.step];
  const aside = (
    <nav aria-label={t.title} className="flex flex-col gap-3 lg:panel lg:p-3">
      <div className="px-1 lg:px-2 lg:pt-1">
        <Progress
          value={index + 1}
          max={STEPS.length}
          tone="go"
          label={t.stepOf(index + 1, STEPS.length)}
        />
      </div>
      <ol className="flex gap-1 overflow-x-auto lg:flex-col">
        {STEPS.map((s, i) => (
          <li key={s} className="shrink-0">
            <button
              type="button"
              onClick={() => i < index && go(s)}
              disabled={i > index}
              aria-current={s === d.step ? 'step' : undefined}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-body transition-colors',
                s === d.step ? 'bg-navy-50 font-medium text-navy-950' : 'text-ink-muted',
                i < index && 'hover:bg-paper hover:text-ink',
              )}
            >
              <span
                className={cx(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-caption',
                  i < index
                    ? 'bg-signal-go-tint text-signal-go-ink'
                    : s === d.step
                      ? 'bg-navy-950 text-white'
                      : 'border border-line-strong',
                )}
              >
                {i < index ? <Check aria-hidden className="size-3.5" /> : i + 1}
              </span>
              {t.steps[s]}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );

  return (
    <Frame aside={aside}>
      <header className="flex items-start gap-4 motion-safe:animate-rise" key={d.step}>
        <IconTile icon={StepIcon} area={stepArea} size="lg" className="hidden sm:flex" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-caption text-ink-muted">
            {t.stepOf(index + 1, STEPS.length)} · {t.plan(state.planName)}
            {saving !== 'idle' && ` · ${saving === 'saving' ? t.saving : t.saved}`}
          </p>
          <h1 className="text-title font-semibold text-ink">
            {d.step === 'profile' ? t.welcome(state.name) : t.steps[d.step]}
          </h1>
          {d.step === 'profile' && (
            <p className="max-w-prose text-body text-ink-muted">{t.intro}</p>
          )}
        </div>
      </header>

      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          if (d.step === 'review') void create();
          else forward();
        }}
        className="flex flex-col gap-5"
        noValidate={false}
      >
        {d.step === 'profile' && (
          <section className="panel grid gap-4 p-5 sm:grid-cols-2">
            <Field label={t.name}>
              <input
                required
                minLength={2}
                value={d.admin.name}
                onChange={(e) => set('admin', { ...d.admin, name: e.target.value })}
                className={field}
              />
            </Field>
            <Field label={t.designation} hint={t.designationHint}>
              <input
                required
                minLength={2}
                value={d.admin.designation}
                onChange={(e) => set('admin', { ...d.admin, designation: e.target.value })}
                className={field}
              />
            </Field>
            <Field label={t.email}>
              <input
                type="email"
                value={d.admin.email}
                onChange={(e) => set('admin', { ...d.admin, email: e.target.value })}
                className={field}
              />
            </Field>
            <p className="self-end text-caption text-ink-muted">{t.phone(state.phone)}</p>
          </section>
        )}

        {d.step === 'organisation' && (
          <section className="panel grid gap-4 p-5 sm:grid-cols-2">
            <Field label={t.orgName} hint={t.orgNameHint} className="sm:col-span-2">
              <input
                required
                minLength={2}
                value={d.organisation.name}
                onChange={(e) => set('organisation', { ...d.organisation, name: e.target.value })}
                className={field}
              />
            </Field>
            <Field label={t.legalName} hint={t.legalNameHint}>
              <input
                required
                minLength={2}
                value={d.organisation.legalEntityName || d.organisation.name}
                onChange={(e) =>
                  set('organisation', { ...d.organisation, legalEntityName: e.target.value })
                }
                className={field}
              />
            </Field>
            <Field label={t.gstin}>
              <input
                pattern="[0-9]{2}[A-Za-z0-9]{13}"
                value={d.organisation.gstin}
                onChange={(e) => set('organisation', { ...d.organisation, gstin: e.target.value })}
                className={field}
              />
            </Field>
          </section>
        )}

        {d.step === 'campuses' && (
          <>
            <p className="text-body text-ink-muted">{t.campusesIntro}</p>
            {d.campuses.map((c, ci) => (
              <section
                key={ci}
                aria-label={t.campus(ci + 1)}
                className="panel grid gap-4 p-5 sm:grid-cols-2"
              >
                <div className="flex items-center justify-between sm:col-span-2">
                  <h2 className="text-body font-semibold text-ink">{t.campus(ci + 1)}</h2>
                  {d.campuses.length > 1 && (
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() =>
                        set(
                          'campuses',
                          d.campuses.filter((_, j) => j !== ci),
                        )
                      }
                    >
                      <Trash2 aria-hidden className="size-4" />
                      {t.removeCampus}
                    </Button>
                  )}
                </div>
                <Field label={t.campusName}>
                  <input
                    required
                    minLength={2}
                    value={c.name}
                    onChange={(e) => setCampus(ci, { name: e.target.value })}
                    className={field}
                  />
                </Field>
                <Field label={t.state}>
                  <select
                    value={c.stateCode}
                    onChange={(e) => setCampus(ci, { stateCode: e.target.value })}
                    className={field}
                  >
                    {Object.entries(STATES).map(([code, name]) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t.addressLine} className="sm:col-span-2">
                  <input
                    required
                    value={c.addressLine}
                    onChange={(e) => setCampus(ci, { addressLine: e.target.value })}
                    className={field}
                  />
                </Field>
                <Field label={t.city}>
                  <input
                    required
                    value={c.city}
                    onChange={(e) => setCampus(ci, { city: e.target.value })}
                    className={field}
                  />
                </Field>
                <Field label={t.district}>
                  <input
                    value={c.district}
                    onChange={(e) => setCampus(ci, { district: e.target.value })}
                    className={field}
                  />
                </Field>
                <Field label={t.pincode}>
                  <input
                    required
                    inputMode="numeric"
                    pattern="[1-9][0-9]{5}"
                    value={c.pincode}
                    onChange={(e) => setCampus(ci, { pincode: e.target.value })}
                    className={field}
                  />
                </Field>
              </section>
            ))}
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => set('campuses', [...d.campuses, newCampus()])}
            >
              <Plus aria-hidden className="size-4" />
              {t.addCampus}
            </Button>
          </>
        )}

        {d.step === 'institutions' &&
          d.campuses.map((c, ci) => (
            <section
              key={ci}
              aria-label={t.institutionsIntro(c.name)}
              className="flex flex-col gap-3"
            >
              <h2 className="text-lead font-semibold text-ink">{t.institutionsIntro(c.name)}</h2>
              {c.schools.map((s, si) => (
                <div key={si} className="panel grid gap-4 p-5 sm:grid-cols-3">
                  <fieldset className="flex flex-col gap-1.5 sm:col-span-3">
                    <legend className="mb-1.5 text-caption font-medium text-ink">{t.kind}</legend>
                    <div className="flex flex-wrap gap-2">
                      {(['school', 'college', 'university'] as const).map((k) => {
                        const on = (s.kind ?? 'school') === k;
                        return (
                          <label
                            key={k}
                            className={cx(
                              'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-body has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy-950',
                              on
                                ? 'border-navy-950 bg-navy-50 text-navy-950'
                                : 'border-line text-ink hover:border-line-strong',
                            )}
                          >
                            <input
                              type="radio"
                              name={`kind-${ci}-${si}`}
                              checked={on}
                              onChange={() =>
                                setSchool(ci, si, {
                                  kind: k,
                                  authority: k === 'university' ? 'UGC' : '',
                                })
                              }
                            />
                            {t.kinds[k]}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  <Field
                    label={(s.kind ?? 'school') === 'school' ? t.schoolName : t.institutionName}
                    className="sm:col-span-2"
                  >
                    <input
                      required
                      minLength={2}
                      value={s.name}
                      onChange={(e) => setSchool(ci, si, { name: e.target.value })}
                      className={field}
                    />
                  </Field>
                  {(s.kind ?? 'school') === 'school' ? (
                    <Field label={t.board}>
                      <select value="CBSE" className={field} onChange={() => undefined}>
                        {Object.entries(t.boards).map(([k, v]) => (
                          <option key={k} value={k} disabled={k !== 'CBSE'}>
                            {k === 'CBSE' ? v : `${v} (${t.comingSoon})`}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : s.kind === 'college' ? (
                    <Field label={t.collegeType}>
                      <select
                        value={s.collegeProfile ?? 'affiliated_college'}
                        onChange={(e) =>
                          setSchool(ci, si, {
                            collegeProfile: e.target.value as
                              'affiliated_college' | 'autonomous_college',
                          })
                        }
                        className={field}
                      >
                        <option value="affiliated_college">
                          {t.collegeTypes.affiliated_college}
                        </option>
                        <option value="autonomous_college">
                          {t.collegeTypes.autonomous_college}
                        </option>
                      </select>
                    </Field>
                  ) : (
                    <Field label={t.regulator} hint={t.regulatorHint}>
                      <input
                        required
                        pattern="[A-Za-z0-9-]{2,16}"
                        value={s.authority ?? 'UGC'}
                        onChange={(e) =>
                          setSchool(ci, si, { authority: e.target.value.toUpperCase() })
                        }
                        className={cx(field, 'uppercase')}
                      />
                    </Field>
                  )}
                  {s.kind === 'college' && (
                    <Field label={t.affiliatingUniversity} hint={t.affiliatingHint}>
                      <input
                        required
                        pattern="[A-Za-z0-9-]{2,16}"
                        value={s.authority ?? ''}
                        onChange={(e) =>
                          setSchool(ci, si, { authority: e.target.value.toUpperCase() })
                        }
                        className={cx(field, 'uppercase')}
                      />
                    </Field>
                  )}
                  {(s.kind ?? 'school') === 'school' && (
                    <Field label={t.udise} hint={t.udiseHint}>
                      <input
                        inputMode="numeric"
                        pattern="[0-9]{11}"
                        value={s.udiseCode}
                        onChange={(e) => setSchool(ci, si, { udiseCode: e.target.value })}
                        className={field}
                      />
                    </Field>
                  )}
                  <Field label={t.affiliation}>
                    <input
                      value={s.affiliationNumber}
                      onChange={(e) => setSchool(ci, si, { affiliationNumber: e.target.value })}
                      className={field}
                    />
                  </Field>
                  <Field label={t.established}>
                    <input
                      inputMode="numeric"
                      pattern="(18|19|20)[0-9]{2}"
                      value={s.establishedYear}
                      onChange={(e) => setSchool(ci, si, { establishedYear: e.target.value })}
                      className={field}
                    />
                  </Field>
                  {(s.kind ?? 'school') === 'school' && (
                    <Field label={t.medium}>
                      <input
                        value={s.medium}
                        onChange={(e) => setSchool(ci, si, { medium: e.target.value })}
                        className={field}
                      />
                    </Field>
                  )}
                  {(s.kind ?? 'school') === 'school' && (
                    <Field label={t.lowest}>
                      <select
                        value={s.lowestClass}
                        onChange={(e) => setSchool(ci, si, { lowestClass: e.target.value })}
                        className={field}
                      >
                        {CLASSES.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {(s.kind ?? 'school') === 'school' && (
                    <Field label={t.highest}>
                      <select
                        value={s.highestClass}
                        onChange={(e) => setSchool(ci, si, { highestClass: e.target.value })}
                        className={field}
                      >
                        {CLASSES.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field label={t.schoolPhone}>
                    <input
                      type="tel"
                      pattern="(\+91)?[0-9]{10}"
                      value={s.phone}
                      onChange={(e) => setSchool(ci, si, { phone: e.target.value })}
                      className={field}
                    />
                  </Field>
                  <Field label={t.schoolEmail}>
                    <input
                      type="email"
                      value={s.email}
                      onChange={(e) => setSchool(ci, si, { email: e.target.value })}
                      className={field}
                    />
                  </Field>
                  <Field label={t.website}>
                    <input
                      type="url"
                      placeholder="https://"
                      value={s.website}
                      onChange={(e) => setSchool(ci, si, { website: e.target.value })}
                      className={field}
                    />
                  </Field>
                  {c.schools.length > 1 && (
                    <Button
                      variant="quiet"
                      size="sm"
                      className="self-end justify-self-start"
                      onClick={() =>
                        setCampus(ci, { schools: c.schools.filter((_, j) => j !== si) })
                      }
                    >
                      <Trash2 aria-hidden className="size-4" />
                      {t.removeInstitution}
                    </Button>
                  )}
                </div>
              ))}
              <Button
                variant="secondary"
                className="self-start"
                onClick={() => setCampus(ci, { schools: [...c.schools, newSchool()] })}
              >
                <Plus aria-hidden className="size-4" />
                {t.addInstitution}
              </Button>
            </section>
          ))}

        {d.step === 'review' && (
          <section className="panel flex flex-col divide-y divide-line">
            <p className="p-5 text-body text-ink-muted">{t.reviewIntro}</p>
            <Review label={t.steps.profile ?? ''} onEdit={() => go('profile')}>
              {d.admin.name} · {d.admin.designation}
              {d.admin.email && ` · ${d.admin.email}`}
            </Review>
            <Review label={t.steps.organisation ?? ''} onEdit={() => go('organisation')}>
              {d.organisation.name} · {d.organisation.legalEntityName || d.organisation.name}
              {d.organisation.gstin && ` · ${d.organisation.gstin.toUpperCase()}`}
            </Review>
            {d.campuses.map((c, ci) => (
              <Review key={ci} label={c.name} onEdit={() => go('campuses')}>
                {[c.addressLine, c.city, STATES[c.stateCode as keyof typeof STATES], c.pincode]
                  .filter(Boolean)
                  .join(', ')}
                <ul className="mt-1 flex flex-col">
                  {c.schools.map((s, si) => (
                    <li key={si} className="text-ink">
                      {s.name} ·{' '}
                      {(s.kind ?? 'school') === 'school'
                        ? `CBSE · ${s.lowestClass}–${s.highestClass}`
                        : s.kind === 'college'
                          ? `${t.kinds.college} · ${(s.authority ?? '').toUpperCase()}`
                          : `${t.kinds.university} · ${(s.authority ?? 'UGC').toUpperCase()}`}
                    </li>
                  ))}
                </ul>
              </Review>
            ))}
          </section>
        )}

        {error && (
          <p role="alert" className="text-caption text-signal-stop-ink">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-between gap-3">
          <Button
            variant="quiet"
            disabled={index === 0 || busy}
            onClick={() => {
              const prev = STEPS[index - 1];
              if (prev) go(prev);
            }}
          >
            {t.back}
          </Button>
          <Button type="submit" disabled={busy}>
            {d.step === 'review' ? (busy ? t.creating : t.create) : t.next}
          </Button>
        </div>
      </form>
    </Frame>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      <span className="text-caption font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-caption text-ink-muted">{hint}</span>}
    </label>
  );
}

function Review({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 p-5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-caption font-medium text-ink-muted">{label}</span>
        <div className="text-body text-ink">{children}</div>
      </div>
      <Button variant="quiet" size="sm" onClick={onEdit}>
        {t.edit}
      </Button>
    </div>
  );
}
