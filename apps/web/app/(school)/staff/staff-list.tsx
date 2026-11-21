'use client';

import {
  Avatar,
  Button,
  EmptyState,
  PageHeader,
  Pill,
  FormModal,
  Segmented,
  SkeletonRows,
  StatePanel,
  KeyFigures,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { BriefcaseBusiness, ChevronRight, Download, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { exportCsv } from '../../../lib/csv';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { CustomFields, fieldInput, useFields, type Values } from '../common/custom-fields';
import { useMe } from '../common/me';

const t = en.staffPages;
type Staff = {
  personId: string;
  name: string;
  employeeCode: string;
  status: string;
  designation: string | null;
  category: 'teaching' | 'administrative' | 'support' | null;
  roleKeys: string[];
  checksDue: { kind: string; state: 'expiring' | 'expired' | 'missing' }[];
  photoFileId: string | null;
};
const CATEGORIES = ['all', 'teaching', 'administrative', 'support'] as const;
const WORK = [
  'teacher',
  'office',
  'driver',
  'bus_attendant',
  'security',
  'warden',
  'nurse',
  'none',
] as const;
/** What each work role needs on file (people/records REQUIRED_CHECKS; 'none' is support). */
const WORK_CHECKS: Record<(typeof WORK)[number], string[]> = {
  teacher: ['police_verification'],
  office: ['police_verification'],
  driver: ['driving_licence', 'police_verification', 'medical_fitness'],
  bus_attendant: ['police_verification'],
  security: ['police_verification'],
  warden: ['police_verification'],
  nurse: ['police_verification'],
  none: ['police_verification'],
};
type Register = { staff: { personId: string; day: { status: string } | null }[] };

export const STAFF_TONE: Record<string, Tone> = {
  active: 'go',
  on_leave: 'warn',
  notice: 'warn',
  invited: 'neutral',
  onboarding: 'neutral',
  left: 'neutral',
};
const TODAY_TONE: Record<string, Tone> = {
  present: 'go',
  half_day: 'warn',
  absent: 'stop',
  on_leave: 'neutral',
  on_duty: 'neutral',
};
export const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const errorOf = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

export function StaffList() {
  const school = useInstitution();
  const { can } = useMe();
  const id = school.institutionId;
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<'current' | 'all'>('current');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [onlyDue, setOnlyDue] = useState(false);
  const [adding, setAdding] = useState(false);
  // A view with several institutions lists everyone in it once, with every institution they work
  // in (one staff record across the group, rule book §12.4); "This institution" narrows to one.
  const many = school.inView.length > 1;
  const [span, setSpan] = useState<'view' | 'one'>('view');
  const wide = many && span === 'view';
  const ids = wide ? school.inView.map((i) => i.id) : id ? [id] : [];
  const names = new Map(school.inView.map((i) => [i.id, i.name]));
  const staff = useQueries({
    queries: ids.map((iid) => ({
      queryKey: ['staff', iid, show],
      queryFn: () =>
        api.get<Staff[]>(
          `/people/staff?institutionId=${iid}${show === 'all' ? '&includeLeft=true' : ''}`,
        ),
    })),
    combine: (rs) => {
      const byPerson = new Map<string, Staff & { institutions: string[] }>();
      rs.forEach((r, n) =>
        (r.data ?? []).forEach((x) => {
          const name = names.get(ids[n] ?? '') ?? '';
          const seen = byPerson.get(x.personId);
          if (seen) seen.institutions.push(name);
          else byPerson.set(x.personId, { ...x, institutions: [name] });
        }),
      );
      return {
        data: rs.length > 0 && rs.every((r) => r.data) ? [...byPerson.values()] : undefined,
        isPending: rs.length === 0 || rs.some((r) => r.isPending),
        isError: rs.some((r) => r.isError),
        error: rs.find((r) => r.error)?.error ?? null,
      };
    },
  });
  // Today's attendance is kept per institution: shown when listing one.
  const today = useQuery({
    queryKey: ['staff-register', id, istToday()],
    queryFn: () =>
      api.get<Register>(`/staff-attendance/register?institutionId=${id}&date=${istToday()}`),
    enabled: !!id && !wide && can('staff.attendance.read'),
  });
  const days = new Map((today.data?.staff ?? []).map((s) => [s.personId, s.day?.status ?? null]));
  const q = query.trim().toLowerCase();
  const shown = (staff.data ?? []).filter(
    (s) =>
      (!q || s.name.toLowerCase().includes(q) || s.employeeCode.toLowerCase().includes(q)) &&
      (category === 'all' || s.category === category) &&
      (!onlyDue || s.checksDue.length > 0),
  );
  const due = (staff.data ?? []).filter((s) => s.status !== 'left' && s.checksDue.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={BriefcaseBusiness}
        art="students"
        area="teal"
        eyebrow={en.nav.groups.people}
        title={t.title}
        description={t.lead}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!id || shown.length === 0}
              onClick={() =>
                void exportCsv(
                  'staff',
                  id ?? '',
                  'staff',
                  [
                    t.csv.code,
                    t.csv.name,
                    t.csv.designation,
                    t.csv.status,
                    ...(wide ? [en.view.institution] : []),
                  ],
                  shown.map((s) => [
                    s.employeeCode,
                    s.name,
                    s.designation,
                    t.statuses[s.status] ?? s.status,
                    ...(wide ? [s.institutions.join('; ')] : []),
                  ]),
                )
              }
            >
              <Download aria-hidden className="size-4" />
              {t.download}
            </Button>
            {can('people.staff.create') && !adding && (
              <Button onClick={() => setAdding(true)}>
                <Plus aria-hidden className="size-4" />
                {t.add}
              </Button>
            )}
          </>
        }
      />
      {adding && id && <AddStaff institutionId={id} onCancel={() => setAdding(false)} />}
      {staff.isError ? (
        staff.error instanceof ApiFailure && staff.error.status === 403 ? (
          <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
        ) : (
          <StatePanel kind="error" title={en.states.error.title} />
        )
      ) : (
        <>
          <KeyFigures
            variant="strip"
            label={t.title}
            loading={staff.isPending}
            figures={[
              { label: t.figures.total, value: String(staff.data?.length ?? 0) },
              {
                label: t.figures.active,
                value: String(staff.data?.filter((x) => x.status === 'active').length ?? 0),
                tone: 'go',
              },
              {
                label: t.figures.inToday,
                value: String(
                  (staff.data ?? []).filter((x) => {
                    const d = days.get(x.personId);
                    return d === 'present' || d === 'half_day' || d === 'on_duty';
                  }).length,
                ),
              },
              {
                label: t.figures.checksDue,
                value: String(due.length),
                tone: due.length > 0 ? 'warn' : 'go',
              },
            ]}
          />
          <section aria-labelledby="staff-directory" className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-6 py-5">
              <h2
                id="staff-directory"
                className="mr-auto font-display text-[1.25rem] font-semibold text-ink"
              >
                {t.directory}
              </h2>
              <label className="flex h-10 w-full items-center gap-2 rounded-xl bg-navy-50/60 px-3 focus-within:ring-2 focus-within:ring-navy-950/20 sm:w-64">
                <Search aria-hidden className="size-4 shrink-0 text-ink-muted" />
                <input
                  aria-label={t.search}
                  placeholder={t.search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
                />
              </label>
              {many && (
                <Segmented
                  label={en.view.span}
                  value={span}
                  onChange={setSpan}
                  options={[
                    { value: 'view', label: en.view.spanView(school.inView.length) },
                    { value: 'one', label: en.view.spanOne },
                  ]}
                />
              )}
              <Segmented
                label={t.categoryFilter}
                value={category}
                onChange={setCategory}
                options={CATEGORIES.map((c) => ({ value: c, label: t.categories[c] ?? c }))}
              />
              <button
                type="button"
                aria-pressed={onlyDue}
                onClick={() => setOnlyDue((x) => !x)}
                className={
                  onlyDue
                    ? 'inline-flex h-10 items-center rounded-lg bg-navy-950 px-3 text-body font-medium text-white'
                    : 'inline-flex h-10 items-center rounded-lg px-3 text-body font-medium text-navy-950 ring-1 ring-line hover:bg-navy-50'
                }
              >
                {t.onlyChecksDue}
              </button>
              <Segmented
                label={t.title}
                value={show}
                onChange={setShow}
                options={[
                  { value: 'current', label: t.current },
                  { value: 'all', label: t.everyone },
                ]}
              />
            </div>
            <div className="border-t border-line/60">
              {staff.isPending || school.isPending ? (
                <SkeletonRows rows={6} label={en.states.loading.title} />
              ) : (staff.data ?? []).length === 0 ? (
                <EmptyState art="students" title={t.empty} body={t.emptyBody} />
              ) : shown.length === 0 ? (
                <EmptyState
                  compact
                  art="search"
                  title={t.noMatch}
                  actions={
                    <Button variant="secondary" onClick={() => setQuery('')}>
                      {t.clear}
                    </Button>
                  }
                />
              ) : (
                <ul aria-label={t.title} className="divide-y divide-line">
                  {shown.map((s) => {
                    const d = days.get(s.personId);
                    return (
                      <li key={s.personId}>
                        <Link
                          href={`/staff/${s.personId}`}
                          className="group flex items-center gap-3 px-6 py-3.5 transition-colors hover:bg-navy-50/40"
                        >
                          <Avatar
                            name={s.name}
                            size="lg"
                            src={
                              s.photoFileId
                                ? `/api/v1/people/${s.personId}/photo?v=${s.photoFileId}`
                                : null
                            }
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-medium text-ink group-hover:text-navy-950">
                              {s.name}
                            </span>
                            <span className="truncate text-caption text-ink-muted">
                              {[
                                s.designation ??
                                  s.roleKeys.map((r) => t.roles[r] ?? r).join(', ') ??
                                  null,
                                s.employeeCode,
                                wide ? s.institutions.join(', ') : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                          {s.status !== 'left' && s.checksDue.length > 0 && (
                            <Pill
                              tone={
                                s.checksDue.some((c) => c.state === 'expired') ? 'stop' : 'warn'
                              }
                            >
                              {t.checksDue(
                                s.checksDue.length,
                                s.checksDue.some((c) => c.state === 'expired'),
                              )}
                            </Pill>
                          )}
                          {!wide && can('staff.attendance.read') && s.status !== 'left' && (
                            <Pill tone={d ? (TODAY_TONE[d] ?? 'neutral') : 'neutral'}>
                              {t.today[d ?? 'none']}
                            </Pill>
                          )}
                          {s.status !== 'active' && (
                            <Pill tone={STAFF_TONE[s.status] ?? 'neutral'}>
                              {t.statuses[s.status] ?? s.status}
                            </Pill>
                          )}
                          <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function AddStaff({ institutionId, onCancel }: { institutionId: string; onCancel: () => void }) {
  const router = useRouter();
  const fields = useFields('staff');
  const f = t.form;
  const [form, setForm] = useState({
    name: '',
    phone: '',
    employeeCode: '',
    designation: '',
    department: '',
    employmentType: 'permanent',
    joinedOn: istToday(),
    gender: '',
  });
  const [work, setWork] = useState<(typeof WORK)[number]>('teacher');
  const [custom, setCustom] = useState<Values>({});
  const create = useMutation({
    mutationFn: () =>
      api.post<{ personId: string }>('/people/staff', {
        institutionId,
        name: form.name.trim(),
        phone: `+91${form.phone.replace(/\D/g, '').slice(-10)}`,
        employeeCode: form.employeeCode.trim() || null,
        designation: form.designation.trim() || null,
        department: form.department.trim() || null,
        employmentType: form.employmentType || null,
        joinedOn: form.joinedOn,
        gender: form.gender || null,
        workRole: work === 'none' ? null : work,
        ...(Object.keys(custom).length ? { custom } : {}),
      }),
    onSuccess: (r) => router.push(`/staff/${r.personId}`),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((x) => ({ ...x, [k]: e.target.value }));
  const problems =
    create.error instanceof ApiFailure && create.error.code === 'values'
      ? ((create.error.details as { problems?: Record<string, string> } | null)?.problems ?? {})
      : {};
  return (
    <FormModal
      title={f.title}
      size="xl"
      submitLabel={f.create}
      cancelLabel={f.cancel}
      pending={create.isPending}
      error={create.isError ? errorOf(create.error) : null}
      onClose={onCancel}
      onSubmit={() => create.mutate()}
    >
      <div className="flex flex-col gap-6 sm:col-span-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-caption font-medium text-ink">{f.worksAs}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {WORK.map((w) => (
              <label
                key={w}
                className="flex cursor-pointer items-center justify-center rounded-lg px-3 py-2.5 text-center text-body text-ink ring-1 ring-line has-[:checked]:bg-navy-50 has-[:checked]:font-semibold has-[:checked]:text-navy-950 has-[:checked]:ring-2 has-[:checked]:ring-navy-950 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-navy-950"
              >
                <input
                  type="radio"
                  name="works-as"
                  value={w}
                  checked={work === w}
                  onChange={() => setWork(w)}
                  className="sr-only"
                />
                {f.work[w]}
              </label>
            ))}
          </div>
          <p className="text-caption text-ink-muted">
            {f.worksAsHint(
              work === 'none',
              WORK_CHECKS[work].map((c) => t.checks.kinds[c]).join(', '),
            )}
          </p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <L label={f.name}>
            <input
              required
              minLength={2}
              value={form.name}
              onChange={set('name')}
              className={fieldInput}
            />
          </L>
          <L label={f.phone} hint={f.phoneHint}>
            <input
              required
              type="tel"
              inputMode="tel"
              pattern="[\d\s+]{10,15}"
              value={form.phone}
              onChange={set('phone')}
              className={fieldInput}
            />
          </L>
          <L label={f.code} hint={f.codeHint}>
            <input
              value={form.employeeCode}
              onChange={set('employeeCode')}
              className={fieldInput}
            />
          </L>
          <L label={f.designation}>
            <input
              value={form.designation}
              onChange={set('designation')}
              placeholder={f.workExample[work]}
              className={fieldInput}
            />
          </L>
          <L label={f.department}>
            <input value={form.department} onChange={set('department')} className={fieldInput} />
          </L>
          <L label={f.employmentType}>
            <select
              value={form.employmentType}
              onChange={set('employmentType')}
              className={fieldInput}
            >
              {Object.entries(t.employment).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </L>
          <L label={f.joinedOn}>
            <input
              required
              type="date"
              value={form.joinedOn}
              onChange={set('joinedOn')}
              className={fieldInput}
            />
          </L>
          <L label={f.gender}>
            <select value={form.gender} onChange={set('gender')} className={fieldInput}>
              <option value="" />
              {Object.entries(t.genders).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </L>
        </div>
        {fields.data && fields.data.length > 0 && (
          <div className="flex flex-col gap-4 border-t border-line pt-6">
            <p className="text-body font-semibold text-ink">{en.customFields.title}</p>
            <CustomFields
              fields={fields.data}
              values={custom}
              onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))}
              problems={problems}
              idPrefix="new-staff"
            />
          </div>
        )}
      </div>
    </FormModal>
  );
}

export function L({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={wide ? 'flex flex-col gap-1.5 sm:col-span-2' : 'flex flex-col gap-1.5'}>
      <span className="text-caption font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-caption text-ink-muted">{hint}</span>}
    </label>
  );
}
