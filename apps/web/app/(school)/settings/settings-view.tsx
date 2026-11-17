'use client';

import type { SchoolProfile } from '@campusverse/school-setup';
import {
  Button,
  IconTile,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, School } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { RecordStamp } from '../common/activity';
import { CustomFields, changedValues, useFields, type Values } from '../common/custom-fields';
import { ImageUpload } from '../common/image-upload';
import { useMe } from '../common/me';
import { SettingsFrame } from './frame';

const t = en.settings;
const field =
  'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-ink shadow-[var(--shadow-card)] outline-none focus:border-navy-950';
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
type Tree = {
  organisation: { name: string };
  campuses: {
    campusId: string;
    name: string;
    city: string | null;
    institutions: { institutionId: string; name: string; type: string; status: string }[];
  }[];
};
const STATUS_TONE: Record<string, Tone> = {
  live: 'go',
  pilot: 'go',
  setup: 'warn',
  draft: 'neutral',
};

export function SettingsView() {
  const school = useInstitution();
  const tree = useQuery({
    queryKey: ['scope-tree'],
    queryFn: () => api.get<Tree>('/school/setup/tree'),
  });

  return (
    <SettingsFrame title={t.title} lead={t.lead}>
      {school.institutionId && <ProfileForm institutionId={school.institutionId} />}
      {school.institutionId && <SchoolImages institutionId={school.institutionId} />}

      <Section title={t.organisation} description={t.organisationLead}>
        {tree.data ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <IconTile icon={Building2} />
              <span className="text-lead font-semibold text-ink">
                {tree.data.organisation.name}
              </span>
            </div>
            {tree.data.campuses.map((c) => (
              <div key={c.campusId} className="flex flex-col gap-2 border-l-2 border-line pl-5">
                <p className="text-body font-semibold text-ink">
                  {c.name}
                  {c.city && <span className="font-normal text-ink-muted"> · {c.city}</span>}
                </p>
                <ul className="flex flex-col gap-2">
                  {c.institutions.map((i) => (
                    <li
                      key={i.institutionId}
                      className="flex flex-wrap items-center gap-3 rounded-md bg-paper px-3 py-2"
                    >
                      <School aria-hidden className="size-4 text-ink-muted" />
                      <span className="flex-1 text-body text-ink">{i.name}</span>
                      {i.institutionId === school.institutionId && (
                        <Pill tone="neutral">{t.current}</Pill>
                      )}
                      <Pill tone={STATUS_TONE[i.status] ?? 'neutral'}>
                        {t.statuses[i.status] ?? i.status}
                      </Pill>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <SkeletonRows rows={2} label={en.states.loading.title} />
        )}
      </Section>
    </SettingsFrame>
  );
}

type Editable = Exclude<
  keyof SchoolProfile,
  'board' | 'stateCode' | 'status' | 'campus' | 'custom'
>;
const GROUPS: Editable[][] = [
  [
    'name',
    'udiseCode',
    'affiliationNumber',
    'establishedYear',
    'medium',
    'lowestClass',
    'highestClass',
  ],
  ['addressLine', 'city', 'district', 'pincode'],
  ['phone', 'email', 'website'],
];

function ProfileForm({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const key = ['school-profile', institutionId];
  const profile = useQuery({
    queryKey: key,
    queryFn: () => api.get<SchoolProfile>(`/school/setup/${institutionId}/profile`),
  });
  const fields = useFields('institution');
  const [form, setForm] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Values>({});
  useEffect(() => {
    if (profile.data) setCustom(profile.data.custom);
    if (profile.data)
      setForm(
        Object.fromEntries(
          GROUPS.flat().map((k) => [k, profile.data[k] === null ? '' : String(profile.data[k])]),
        ),
      );
  }, [profile.data]);
  const changed = GROUPS.flat().filter(
    (k) =>
      profile.data &&
      form[k] !== undefined &&
      form[k] !== (profile.data[k] === null ? '' : String(profile.data[k])),
  );
  const customChanged =
    profile.data && fields.data ? changedValues(fields.data, profile.data.custom, custom) : {};
  const dirty = changed.length + Object.keys(customChanged).length;
  const save = useMutation({
    mutationFn: () =>
      api.post(`/school/setup/${institutionId}/profile`, {
        ...Object.fromEntries(
          changed.map((k) => [
            k,
            k === 'establishedYear' ? (form[k] ? Number(form[k]) : null) : form[k]?.trim() || null,
          ]),
        ),
        ...(Object.keys(customChanged).length ? { custom: customChanged } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['stamps'] });
      void qc.invalidateQueries({ queryKey: ['scope-tree'] });
      void qc.invalidateQueries({ queryKey: ['institutions'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  if (profile.isPending)
    return (
      <Section title={t.school}>
        <SkeletonRows rows={3} label={en.states.loading.title} />
      </Section>
    );
  if (profile.isError || !profile.data)
    return <StatePanel kind="error" title={en.states.error.title} />;
  const p = profile.data;
  const forbidden = save.error instanceof ApiFailure && save.error.status === 403;

  return (
    <form onSubmit={submit} aria-label={t.school}>
      <Section
        title={t.school}
        description={`${t.schoolLead} ${t.board}: ${p.board} · ${t.campus}: ${p.campus}`}
        footer={
          <>
            <span className="flex-1" role="status">
              {save.isSuccess && !save.isPending && dirty === 0
                ? t.saved
                : save.isError
                  ? forbidden
                    ? t.readOnly
                    : (t.errors[(save.error as ApiFailure).code] ?? t.errors.error)
                  : ''}
            </span>
            <Button type="submit" disabled={save.isPending || dirty === 0}>
              {t.save}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-6">
          {GROUPS.map((g, gi) => (
            <div key={gi} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.map((k) => (
                <label
                  key={k}
                  className={
                    k === 'name' || k === 'addressLine'
                      ? 'flex flex-col gap-1.5 sm:col-span-2'
                      : 'flex flex-col gap-1.5'
                  }
                >
                  <span className="text-caption font-medium text-ink">{t.fields[k]}</span>
                  {k === 'lowestClass' || k === 'highestClass' ? (
                    <select
                      value={form[k] ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                      className={field}
                    >
                      <option value="" />
                      {CLASSES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={form[k] ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                      className={field}
                      {...(k === 'name' ? { required: true, minLength: 2 } : {})}
                      {...(k === 'email' ? { type: 'email' } : {})}
                      {...(k === 'website' ? { type: 'url' } : {})}
                      {...(k === 'pincode'
                        ? { inputMode: 'numeric' as const, pattern: '[1-9][0-9]{5}' }
                        : {})}
                      {...(k === 'udiseCode'
                        ? { inputMode: 'numeric' as const, pattern: '[0-9]{11}' }
                        : {})}
                    />
                  )}
                </label>
              ))}
            </div>
          ))}
          {fields.data && fields.data.length > 0 && (
            <div className="flex flex-col gap-4 border-t border-line pt-6">
              <p className="text-body font-semibold text-ink">{en.customFields.title}</p>
              <CustomFields
                fields={fields.data}
                values={custom}
                onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))}
                problems={
                  save.error instanceof ApiFailure && save.error.code === 'values'
                    ? ((save.error.details as { problems?: Record<string, string> } | null)
                        ?.problems ?? {})
                    : {}
                }
                idPrefix="institution"
              />
            </div>
          )}
          <RecordStamp id={institutionId} className="border-t border-line pt-4" />
        </div>
      </Section>
    </form>
  );
}

/** The school's logo and the principal's signature, for those who manage setup. */
function SchoolImages({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const { can } = useMe();
  const profile = useQuery({
    queryKey: ['school-profile', institutionId],
    queryFn: () => api.get<SchoolProfile>(`/school/setup/${institutionId}/profile`),
  });
  if (!can('school.setup.manage') || !profile.data) return null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['school-profile', institutionId] });
    void qc.invalidateQueries({ queryKey: ['stamps'] });
  };
  const p = profile.data;
  return (
    <Section title={en.schoolImages.title} description={en.schoolImages.lead}>
      <div className="grid gap-8 md:grid-cols-2">
        <ImageUpload
          label={en.schoolImages.logo}
          name={p.name}
          shape="wide"
          src={`/api/v1/school/setup/${institutionId}/logo`}
          currentFileId={p.logoFileId}
          uploadPath={`/school/setup/${institutionId}/logo`}
          onChanged={refresh}
        />
        <ImageUpload
          label={en.schoolImages.signature}
          name={p.name}
          shape="wide"
          src={`/api/v1/school/setup/${institutionId}/signature`}
          currentFileId={p.hasSignature ? 'on-file' : null}
          uploadPath={`/school/setup/${institutionId}/signature`}
          hint={en.schoolImages.signatureHint}
          onChanged={refresh}
        />
      </div>
    </Section>
  );
}
