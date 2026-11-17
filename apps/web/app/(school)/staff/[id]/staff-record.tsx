'use client';

import type { StaffDetails, StaffRecord } from '@campusverse/people-records';
import { Button, Pill, Section, SkeletonRows, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Briefcase,
  CalendarDays,
  CalendarOff,
  IdCard,
  Mail,
  Phone,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useInstitution } from '../../attendance/shared';
import { ProfileHero, ProfileTabsList } from '../../common/profile360';
import { StaffOverview, StaffSalary, StaffStats, useStaff360 } from './staff-360';
import { formatDate } from '../../setup/shared';
import { Tabs } from 'radix-ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { RecordStamp } from '../../common/activity';
import {
  CustomFields,
  changedValues,
  fieldInput,
  useFields,
  type Values,
} from '../../common/custom-fields';
import { DocumentsPanel, personDocuments } from '../../common/documents';
import { ImageUpload } from '../../common/image-upload';
import { useMe } from '../../common/me';
import { L, STAFF_TONE, errorOf } from '../staff-list';
import { MonthCalendar } from '../../staff-attendance/month-calendar';
import { StaffChecks } from './staff-checks';

const t = en.staffRecord;
const s = en.staffPages;
const STAFF_FOLDERS = [
  'identity',
  'qualifications',
  'employment',
  'payroll',
  'medical',
  'other',
] as const;
const TABS = [
  'overview',
  'details',
  'salary',
  'attendance',
  'documents',
  'checks',
  'access',
] as const;

export function StaffRecordView({ personId }: { personId: string }) {
  const { can } = useMe();
  const school = useInstitution();
  const services = useStaff360(personId, school.institutionId ?? null);
  const p = t.p360;
  const record = useQuery({
    queryKey: ['staff-record', personId],
    queryFn: () => api.get<StaffRecord>(`/people/staff/${personId}`),
  });
  if (record.isPending) return <SkeletonRows rows={6} label={en.states.loading.title} />;
  if (record.isError || !record.data)
    return record.error instanceof ApiFailure && record.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} />
    );
  const r = record.data;
  const tabs = TABS.filter(
    (k) =>
      (k !== 'documents' || can('people.staff.documents')) &&
      (k !== 'attendance' || can('staff.attendance.read')) &&
      (k !== 'salary' || can('payroll.salary.manage')),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/staff"
          className="inline-flex items-center gap-2 rounded-lg px-1 text-body font-medium text-ink hover:text-navy-950"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {p.back}
        </Link>
        <span className="flex-1" />
        {can('payroll.salary.manage') && (
          <Link
            href="/payroll"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-body font-medium text-ink shadow-[var(--shadow-card)] hover:bg-navy-50"
          >
            <Wallet aria-hidden className="size-4" />
            {p.actions.salary}
          </Link>
        )}
        {can('staff.leave.manage') && (
          <Link
            href="/staff-leave"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-body font-medium text-ink shadow-[var(--shadow-card)] hover:bg-navy-50"
          >
            <CalendarOff aria-hidden className="size-4" />
            {p.actions.leave}
          </Link>
        )}
      </div>
      <Header record={r} onChanged={() => void record.refetch()} />
      <StaffStats d={services.data} />
      <Tabs.Root defaultValue="overview" className="flex flex-col gap-5">
        <ProfileTabsList
          label={r.person.name}
          tabs={tabs.map((k) => ({ value: k, label: p.tabs[k] ?? k }))}
        />
        <Tabs.Content value="overview">
          <StaffOverview d={services.data} />
        </Tabs.Content>
        <Tabs.Content value="salary">
          <StaffSalary personId={personId} institutionId={school.institutionId ?? null} />
        </Tabs.Content>
        <Tabs.Content value="details">
          <Details record={r} />
        </Tabs.Content>
        <Tabs.Content value="documents">
          <DocumentsPanel paths={personDocuments(personId)} folders={STAFF_FOLDERS} />
        </Tabs.Content>
        <Tabs.Content value="checks">
          <StaffChecks personId={personId} manage={can('people.staff.update')} />
        </Tabs.Content>
        <Tabs.Content value="access">
          <Section
            title={t.roles}
            description={t.rolesLead}
            actions={
              can('platform.role.read') ? (
                <Link
                  href="/settings/access"
                  className="text-body font-medium text-navy-950 hover:underline"
                >
                  {t.manageAccess}
                </Link>
              ) : undefined
            }
          >
            {r.roles.filter(
              (x) => x.until === null || x.until >= new Date().toISOString().slice(0, 10),
            ).length === 0 ? (
              <p className="text-body text-ink-muted">{t.noRoles}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {r.roles.map((x, i) => (
                  <li key={i}>
                    <Pill tone={x.roleKey === 'owner' ? 'go' : 'neutral'}>{x.roleName}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </Tabs.Content>
        <Tabs.Content value="attendance">
          <MonthCalendar personId={personId} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function Header({ record: r, onChanged }: { record: StaffRecord; onChanged: () => void }) {
  const details = useQuery({
    queryKey: ['staff-details', r.person.id],
    queryFn: () => api.get<StaffDetails>(`/people/staff/${r.person.id}/details`),
  });
  const p = t.p360;
  return (
    <ProfileHero
      label={details.data?.department || r.person.designation || p.staff}
      labelIcon={Briefcase}
      photo={
        <ImageUpload
          compact
          label={en.myProfile.photo}
          name={r.person.name}
          src={`/api/v1/people/${r.person.id}/photo`}
          currentFileId={details.data?.photoFileId ?? null}
          uploadPath={`/people/${r.person.id}/photo`}
          canEdit={r.can.update}
          onChanged={onChanged}
        />
      }
      name={r.person.name}
      status={
        <Pill tone={STAFF_TONE[r.person.status] ?? 'neutral'}>
          {s.statuses[r.person.status] ?? r.person.status}
        </Pill>
      }
      subtitle={
        [r.person.designation, details.data?.department].filter(Boolean).join(' · ') || undefined
      }
      contact={
        <>
          {r.phone && (
            <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 hover:text-ink">
              <Phone aria-hidden className="size-3.5" />
              {r.phone}
            </a>
          )}
          {r.workEmail && (
            <a
              href={`mailto:${r.workEmail}`}
              className="inline-flex items-center gap-1.5 hover:text-ink"
            >
              <Mail aria-hidden className="size-3.5" />
              {r.workEmail}
            </a>
          )}
        </>
      }
      stamp={<RecordStamp id={r.person.id} />}
      chips={[
        { icon: IdCard, label: r.person.employeeCode },
        ...(r.person.joinedOn
          ? [{ icon: CalendarDays, label: p.chips.joined(formatDate(r.person.joinedOn)) }]
          : []),
        ...(details.data?.employmentType
          ? [{ icon: Briefcase, label: details.data.employmentType.replace('_', ' ') }]
          : []),
      ]}
    />
  );
}

const TEXT = [
  'department',
  'employmentType',
  'qualifications',
  'gender',
  'dateOfBirth',
  'emergencyName',
  'emergencyPhone',
  'bankIfsc',
  'pfUan',
  'esiNumber',
] as const;

function Details({ record: r }: { record: StaffRecord }) {
  const qc = useQueryClient();
  const fields = useFields('staff');
  const details = useQuery({
    queryKey: ['staff-details', r.person.id],
    queryFn: () => api.get<StaffDetails>(`/people/staff/${r.person.id}/details`),
  });
  const d = details.data;
  const start = useMemo(
    () =>
      d
        ? {
            designation: r.person.designation ?? '',
            joinedOn: r.person.joinedOn ?? '',
            experienceMonths: d.experienceMonths === null ? '' : String(d.experienceMonths),
            ...Object.fromEntries(TEXT.map((k) => [k, (d[k] as string | null) ?? ''])),
          }
        : null,
    [d, r.person.designation, r.person.joinedOn],
  );
  const [form, setForm] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Values>({});
  const [replace, setReplace] = useState({ aadhaar: '', bankAccount: '', pan: '' });
  useEffect(() => {
    if (start) setForm(start);
    if (d) setCustom(d.custom);
  }, [start, d]);
  const editable = r.can.update;
  const changed = start
    ? Object.keys(start).filter((k) => (form[k] ?? '') !== (start as Record<string, string>)[k])
    : [];
  const customChanged = d && fields.data ? changedValues(fields.data, d.custom, custom) : {};
  const dirty =
    changed.length +
    Object.keys(customChanged).length +
    Object.values(replace).filter(Boolean).length;

  const save = useMutation({
    mutationFn: async () => {
      const base: Record<string, unknown> = {};
      if (changed.includes('designation') && form.designation) base.designation = form.designation;
      if (changed.includes('joinedOn') && form.joinedOn) base.joinedOn = form.joinedOn;
      if (replace.pan) base.pan = replace.pan;
      if (Object.keys(base).length) await api.post(`/people/staff/${r.person.id}`, base);
      const more: Record<string, unknown> = Object.fromEntries(
        changed
          .filter((k) => k !== 'designation' && k !== 'joinedOn')
          .map((k) => [
            k,
            k === 'experienceMonths'
              ? form[k]
                ? Number(form[k])
                : null
              : k === 'emergencyPhone' && form[k]
                ? `+91${(form[k] ?? '').replace(/\D/g, '').slice(-10)}`
                : k === 'bankIfsc'
                  ? (form[k] ?? '').toUpperCase() || null
                  : form[k] || null,
          ]),
      );
      if (replace.aadhaar) more.aadhaar = replace.aadhaar;
      if (replace.bankAccount) more.bankAccount = replace.bankAccount;
      if (Object.keys(customChanged).length) more.custom = customChanged;
      if (Object.keys(more).length) await api.post(`/people/staff/${r.person.id}/details`, more);
    },
    onSuccess: () => {
      setReplace({ aadhaar: '', bankAccount: '', pan: '' });
      void qc.invalidateQueries({ queryKey: ['staff-details', r.person.id] });
      void qc.invalidateQueries({ queryKey: ['staff-record', r.person.id] });
      void qc.invalidateQueries({ queryKey: ['stamps'] });
    },
  });
  if (!d || !start) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const problems =
    save.error instanceof ApiFailure && save.error.code === 'values'
      ? ((save.error.details as { problems?: Record<string, string> } | null)?.problems ?? {})
      : {};
  const input = (k: string, extra: Record<string, unknown> = {}) => (
    <input
      value={form[k] ?? ''}
      onChange={set(k)}
      disabled={!editable}
      className={fieldInput}
      {...extra}
    />
  );

  return (
    <form onSubmit={submit} aria-label={t.tabs.details} className="flex flex-col gap-6">
      <Section title={t.work}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <L label={s.form.designation}>{input('designation')}</L>
          <L label={s.form.department}>{input('department')}</L>
          <L label={s.form.employmentType}>
            <select
              value={form.employmentType ?? ''}
              onChange={set('employmentType')}
              disabled={!editable}
              className={fieldInput}
            >
              <option value="" />
              {Object.entries(s.employment).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </L>
          <L label={s.form.joinedOn}>{input('joinedOn', { type: 'date' })}</L>
          <L label={t.experience}>
            {input('experienceMonths', { inputMode: 'numeric', pattern: '[0-9]{0,3}' })}
          </L>
          <L label={t.qualifications} wide>
            {input('qualifications', { maxLength: 500 })}
          </L>
        </div>
      </Section>
      <Section title={t.personal}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <L label={s.form.gender}>
            <select
              value={form.gender ?? ''}
              onChange={set('gender')}
              disabled={!editable}
              className={fieldInput}
            >
              <option value="" />
              {Object.entries(s.genders).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </L>
          <L label={s.form.dateOfBirth}>{input('dateOfBirth', { type: 'date' })}</L>
          <L label={en.myProfile.phone}>
            <span className="flex h-10 items-center rounded-lg bg-paper px-3 text-body text-ink">
              {r.phone ?? '—'}
            </span>
          </L>
          <L label={t.emergencyName}>{input('emergencyName')}</L>
          <L label={t.emergencyPhone}>
            {input('emergencyPhone', { type: 'tel', inputMode: 'tel' })}
          </L>
        </div>
      </Section>
      <Section title={t.identity} description={t.identityLead}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ['aadhaar', t.aadhaar, d.aadhaar],
              ['pan', 'PAN', r.pan],
              ['bankAccount', t.bankAccount, d.bankAccount],
            ] as const
          ).map(([k, label, masked]) => (
            <L key={k} label={label} hint={masked ? t.onFile(masked) : t.notOnFile}>
              <span className="relative flex items-center">
                <ShieldCheck
                  aria-hidden
                  className="pointer-events-none absolute left-3 size-4 text-signal-go"
                />
                <input
                  value={replace[k]}
                  onChange={(e) => setReplace((x) => ({ ...x, [k]: e.target.value }))}
                  disabled={!editable}
                  autoComplete="off"
                  placeholder={masked ?? ''}
                  className={cx(fieldInput, 'pl-9 tabular')}
                />
              </span>
            </L>
          ))}
          <L label={t.bankIfsc}>{input('bankIfsc', { className: cx(fieldInput, 'uppercase') })}</L>
          <L label={t.pfUan}>
            {input('pfUan', {
              className: cx(fieldInput, 'tabular'),
              inputMode: 'numeric',
              maxLength: 12,
            })}
          </L>
          <L label={t.esiNumber}>
            {input('esiNumber', {
              className: cx(fieldInput, 'tabular'),
              inputMode: 'numeric',
              maxLength: 17,
            })}
          </L>
        </div>
      </Section>
      {fields.data && fields.data.length > 0 && (
        <Section title={en.customFields.title}>
          <CustomFields
            fields={fields.data}
            values={custom}
            onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))}
            problems={problems}
            disabled={!editable}
            idPrefix="staff"
          />
        </Section>
      )}
      {editable && (
        <div className="panel flex items-center justify-end gap-3 px-5 py-3">
          <span role="status" className="flex-1 text-body">
            {save.isError ? (
              <span className="text-signal-stop-ink">{errorOf(save.error)}</span>
            ) : save.isSuccess && dirty === 0 ? (
              t.saved
            ) : dirty > 0 ? (
              en.rolesAdmin.unsaved(dirty)
            ) : (
              ''
            )}
          </span>
          <Button type="submit" disabled={dirty === 0 || save.isPending}>
            {t.save}
          </Button>
        </div>
      )}
    </form>
  );
}
