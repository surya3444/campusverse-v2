'use client';

import type { CampusProfile, OrganisationProfile } from '@campusverse/platform-organisation';
import { STATES } from '@campusverse/rules';
import {
  Announcer,
  Button,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LocateFixed, MapPin, Pencil, Plus, School } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
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
import { ImageUpload } from '../../common/image-upload';
import { SettingsFrame } from '../frame';

const t = en.organisationAdmin;
type Data = { organisation: OrganisationProfile; campuses: CampusProfile[] };
type Tree = {
  campuses: {
    campusId: string;
    institutions: { institutionId: string; name: string; status: string }[];
  }[];
};

const problemsOf = (e: unknown): Record<string, string> =>
  e instanceof ApiFailure && e.code === 'values'
    ? ((e.details as { problems?: Record<string, string> } | null)?.problems ?? {})
    : {};
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

/** Text inputs map empty to null, so clearing a box clears the value. */
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

export function OrganisationView() {
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ['organisation'],
    queryFn: () => api.get<Data>('/organisation/profile'),
  });
  const tree = useQuery({
    queryKey: ['scope-tree'],
    queryFn: () => api.get<Tree>('/school/setup/tree'),
  });
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['organisation'] });
    void qc.invalidateQueries({ queryKey: ['scope-tree'] });
    void qc.invalidateQueries({ queryKey: ['stamps'] });
    void qc.invalidateQueries({ queryKey: ['brand'] });
    // A new campus or institution joins the view and the switcher at once.
    void qc.invalidateQueries({ queryKey: ['view'] });
    void qc.invalidateQueries({ queryKey: ['institutions'] });
  };

  return (
    <SettingsFrame title={t.title} lead={t.lead}>
      {data.isPending ? (
        <SkeletonRows rows={6} label={en.states.loading.title} />
      ) : data.isError || !data.data ? (
        data.error instanceof ApiFailure && data.error.status === 403 ? (
          <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
        ) : (
          <StatePanel kind="error" title={en.states.error.title} />
        )
      ) : (
        <>
          <Identity org={data.data.organisation} onSaved={() => (setMessage(t.saved), refresh())} />
          <section aria-labelledby="campuses" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="campuses" className="text-lead font-semibold text-ink">
                  {t.campuses}
                </h2>
                <p className="text-body text-ink-muted">{t.campusesLead}</p>
              </div>
              <Button variant="secondary" onClick={() => setAdding(true)} aria-haspopup="dialog">
                <Plus aria-hidden className="size-4" />
                {t.addCampus}
              </Button>
            </div>
            {adding && (
              <CampusForm
                campus={null}
                onCancel={() => setAdding(false)}
                onSaved={() => (setAdding(false), setMessage(t.added), refresh())}
              />
            )}
            {data.data.campuses.map((c) => (
              <CampusCard
                key={c.campusId}
                campus={c}
                schools={
                  tree.data?.campuses.find((x) => x.campusId === c.campusId)?.institutions ?? []
                }
                onSaved={() => (setMessage(t.saved), refresh())}
              />
            ))}
          </section>
        </>
      )}
      <Announcer message={message} />
    </SettingsFrame>
  );
}

function Field({
  label,
  wide,
  hint,
  children,
}: {
  label: string;
  wide?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx('flex flex-col gap-1.5', wide && 'sm:col-span-2')}>
      <span className="text-caption font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-caption text-ink-muted">{hint}</span>}
    </label>
  );
}

const ORG_TEXT = [
  'name',
  'legalName',
  'gstin',
  'tan',
  'registeredAddress',
  'phone',
  'email',
  'website',
] as const;

function Identity({ org, onSaved }: { org: OrganisationProfile; onSaved: () => void }) {
  const fields = useFields('organisation');
  const initial = () => ({
    ...Object.fromEntries(ORG_TEXT.map((k) => [k, org[k] ?? ''])),
    brandColour: org.brandColour ?? '#2150e0',
  });
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [custom, setCustom] = useState<Values>(org.custom);
  useEffect(() => {
    setForm(initial());
    setCustom(org.custom);
  }, [org]);
  const changed = [...ORG_TEXT, 'brandColour' as const].filter(
    (k) =>
      (form[k] ?? '') !== ((k === 'brandColour' ? (org.brandColour ?? '#2150e0') : org[k]) ?? ''),
  );
  const customChanged = fields.data ? changedValues(fields.data, org.custom, custom) : {};
  const dirty = changed.length + Object.keys(customChanged).length;
  const save = useMutation({
    mutationFn: () =>
      api.post('/organisation/profile', {
        ...Object.fromEntries(
          changed.map((k) => [
            k,
            k === 'phone' && form[k]
              ? `+91${(form[k] ?? '').replace(/\D/g, '').slice(-10)}`
              : k === 'gstin' || k === 'tan'
                ? orNull((form[k] ?? '').toUpperCase())
                : orNull(form[k] ?? ''),
          ]),
        ),
        ...(Object.keys(customChanged).length ? { custom: customChanged } : {}),
      }),
    onSuccess: onSaved,
  });
  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} aria-label={t.identity}>
      <Section
        title={t.identity}
        description={t.identityLead}
        footer={
          <>
            <span role="status" className="flex-1 text-signal-stop-ink">
              {save.isError ? errorText(save.error) : ''}
            </span>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {t.save}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-6">
          <ImageUpload
            label={t.logo}
            name={org.name}
            shape="wide"
            src="/api/v1/organisation/logo"
            currentFileId={org.logoFileId}
            uploadPath="/organisation/logo"
            onChanged={onSaved}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t.name}>
              <input
                required
                minLength={2}
                value={form.name ?? ''}
                onChange={set('name')}
                className={fieldInput}
              />
            </Field>
            <Field label={t.legalName}>
              <input
                required
                minLength={2}
                value={form.legalName ?? ''}
                onChange={set('legalName')}
                className={fieldInput}
              />
            </Field>
            <Field label={t.gstin}>
              <input
                value={form.gstin ?? ''}
                onChange={set('gstin')}
                pattern="[0-9]{2}[A-Za-z0-9]{13}"
                className={cx(fieldInput, 'uppercase')}
              />
            </Field>
            <Field label={t.tan} hint={t.tanHint}>
              <input
                value={form.tan ?? ''}
                onChange={set('tan')}
                pattern="[A-Za-z]{4}[0-9]{5}[A-Za-z]"
                className={cx(fieldInput, 'uppercase')}
              />
            </Field>
            <Field label={t.registeredAddress} wide>
              <input
                value={form.registeredAddress ?? ''}
                onChange={set('registeredAddress')}
                className={fieldInput}
              />
            </Field>
            <Field label={t.brandColour}>
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.brandColour ?? '#2150e0'}
                  onChange={set('brandColour')}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-line-strong bg-surface p-1"
                />
                <span className="tabular text-body text-ink-muted">{form.brandColour}</span>
              </span>
            </Field>
            <Field label={t.phone}>
              <input
                type="tel"
                inputMode="tel"
                value={form.phone ?? ''}
                onChange={set('phone')}
                className={fieldInput}
              />
            </Field>
            <Field label={t.email}>
              <input
                type="email"
                value={form.email ?? ''}
                onChange={set('email')}
                className={fieldInput}
              />
            </Field>
            <Field label={t.website}>
              <input
                type="url"
                placeholder="https://"
                value={form.website ?? ''}
                onChange={set('website')}
                className={fieldInput}
              />
            </Field>
          </div>
          {fields.data && fields.data.length > 0 && (
            <div className="flex flex-col gap-4 border-t border-line pt-6">
              <p className="text-body font-semibold text-ink">{en.customFields.title}</p>
              <CustomFields
                fields={fields.data}
                values={custom}
                onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))}
                problems={problemsOf(save.error)}
                idPrefix="organisation"
              />
            </div>
          )}
          <RecordStamp id={org.orgId} className="border-t border-line pt-4" />
        </div>
      </Section>
    </form>
  );
}

const CAMPUS_TEXT = [
  'name',
  'addressLine',
  'city',
  'district',
  'stateCode',
  'pincode',
  'phone',
  'email',
  'latitude',
  'longitude',
] as const;

/** A campus at a glance: photo, address, its schools. Changes open in modals. */
function CampusCard({
  campus,
  schools,
  onSaved,
}: {
  campus: CampusProfile;
  schools: { institutionId: string; name: string; status: string }[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [addingSchool, setAddingSchool] = useState(false);
  const address = [
    campus.addressLine,
    campus.city,
    campus.district,
    (STATES as Record<string, string>)[campus.stateCode ?? ''],
    campus.pincode,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Section
      id={`campus-${campus.campusId}`}
      title={campus.name}
      description={t.schools(campus.institutions)}
      actions={
        <Button
          variant="secondary"
          onClick={() => setEditing(true)}
          aria-haspopup="dialog"
          aria-label={`${t.editCampus}: ${campus.name}`}
        >
          <Pencil aria-hidden className="size-4" />
          {t.editCampus}
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ImageUpload
          label={t.photo}
          name={campus.name}
          shape="wide"
          src={`/api/v1/organisation/campuses/${campus.campusId}/photo`}
          currentFileId={campus.photoFileId}
          uploadPath={`/organisation/campuses/${campus.campusId}/photo`}
          onChanged={onSaved}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-ink-muted">{t.address}</dt>
              <dd className="text-body text-ink">{address || t.notGiven}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-ink-muted">{t.location}</dt>
              <dd className="text-body text-ink">
                {campus.latitude !== null && campus.longitude !== null ? (
                  <span className="tabular">
                    {campus.latitude}, {campus.longitude} · {t.radius(campus.geofenceMetres ?? 200)}
                  </span>
                ) : (
                  t.notGiven
                )}
              </dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-body font-semibold text-ink">{t.schoolsTitle}</p>
              <Button
                variant="quiet"
                onClick={() => setAddingSchool(true)}
                aria-haspopup="dialog"
                aria-label={`${t.addSchool}: ${campus.name}`}
              >
                <Plus aria-hidden className="size-4" />
                {t.addSchool}
              </Button>
            </div>
            <ul className="flex flex-col gap-2">
              {schools.map((x) => (
                <li
                  key={x.institutionId}
                  className="flex items-center gap-3 rounded-lg bg-paper px-3 py-2"
                >
                  <School aria-hidden className="size-4 text-ink-muted" />
                  <span className="flex-1 text-body text-ink">{x.name}</span>
                  <Pill>{en.settings.statuses[x.status] ?? x.status}</Pill>
                </li>
              ))}
            </ul>
          </div>
          <RecordStamp id={campus.campusId} />
        </div>
      </div>
      {editing && (
        <CampusForm
          campus={campus}
          onCancel={() => setEditing(false)}
          onSaved={() => (setEditing(false), onSaved())}
        />
      )}
      {addingSchool && (
        <AddSchool
          campus={campus}
          onDone={() => (setAddingSchool(false), onSaved())}
          onCancel={() => setAddingSchool(false)}
        />
      )}
    </Section>
  );
}

/** Adds a campus, or edits one, in a modal. */
function CampusForm({
  campus,
  onSaved,
  onCancel,
}: {
  campus: CampusProfile | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const fields = useFields('campus');
  const initial = () => ({
    ...Object.fromEntries(
      CAMPUS_TEXT.map((k) => [k, campus?.[k] ?? (k === 'stateCode' ? 'KA' : '')]),
    ),
    geofenceMetres: String(campus?.geofenceMetres ?? 200),
  });
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [custom, setCustom] = useState<Values>(campus?.custom ?? {});
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed'>('idle');
  useEffect(() => {
    setForm(initial());
    setCustom(campus?.custom ?? {});
  }, [campus]);
  // Compared with what the form started from, so a default (such as the state) isn't a change.
  const base: Record<string, string> = useMemo(initial, [campus]);
  const changed = [...CAMPUS_TEXT, 'geofenceMetres' as const].filter(
    (k) => !campus || (form[k] ?? '') !== (base[k] ?? ''),
  );
  const customChanged = fields.data ? changedValues(fields.data, campus?.custom ?? {}, custom) : {};
  const dirty = changed.length + Object.keys(customChanged).length;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...Object.fromEntries(
          changed.map((k) => [
            k,
            k === 'geofenceMetres'
              ? Number(form[k])
              : k === 'stateCode'
                ? form[k]
                : k === 'phone' && form[k]
                  ? `+91${(form[k] ?? '').replace(/\D/g, '').slice(-10)}`
                  : orNull(form[k] ?? ''),
          ]),
        ),
        ...(Object.keys(customChanged).length ? { custom: customChanged } : {}),
      };
      return campus
        ? api.post(`/organisation/campuses/${campus.campusId}`, body)
        : api.post('/organisation/campuses', body);
    },
    onSuccess: onSaved,
  });
  const locate = () => {
    if (!('geolocation' in navigator)) return setLocating('failed');
    setLocating('busy');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({
          ...f,
          latitude: p.coords.latitude.toFixed(6),
          longitude: p.coords.longitude.toFixed(6),
        }));
        setLocating('idle');
      },
      () => setLocating('failed'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };
  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const title = campus ? `${t.editCampus}: ${campus.name}` : t.addCampus;

  return (
    <FormModal
      title={title}
      size="xl"
      submitLabel={campus ? t.save : t.addCampus}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={!dirty}
      error={save.isError ? errorText(save.error) : null}
      onClose={onCancel}
      onSubmit={() => save.mutate()}
    >
      <div className="flex flex-col gap-6 sm:col-span-2">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t.campusName}>
            <input
              required
              minLength={2}
              value={form.name ?? ''}
              onChange={set('name')}
              className={fieldInput}
            />
          </Field>
          <Field label={t.address} wide>
            <input
              value={form.addressLine ?? ''}
              onChange={set('addressLine')}
              className={fieldInput}
            />
          </Field>
          <Field label={t.city}>
            <input value={form.city ?? ''} onChange={set('city')} className={fieldInput} />
          </Field>
          <Field label={t.district}>
            <input value={form.district ?? ''} onChange={set('district')} className={fieldInput} />
          </Field>
          <Field label={t.state}>
            <select
              value={form.stateCode ?? 'KA'}
              onChange={set('stateCode')}
              className={fieldInput}
            >
              {Object.entries(STATES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.pincode}>
            <input
              inputMode="numeric"
              pattern="[1-9][0-9]{5}"
              value={form.pincode ?? ''}
              onChange={set('pincode')}
              className={fieldInput}
            />
          </Field>
          <Field label={t.phone}>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone ?? ''}
              onChange={set('phone')}
              className={fieldInput}
            />
          </Field>
          <Field label={t.email}>
            <input
              type="email"
              value={form.email ?? ''}
              onChange={set('email')}
              className={fieldInput}
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-3 rounded-xl bg-paper/70 p-4">
          <legend className="sr-only">{t.location}</legend>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-body font-semibold text-ink">
              <MapPin aria-hidden className="size-4 text-navy-950" />
              {t.location}
            </span>
            <Button
              variant="secondary"
              type="button"
              onClick={locate}
              disabled={locating === 'busy'}
            >
              <LocateFixed aria-hidden className="size-4" />
              {locating === 'busy' ? t.locating : t.useHere}
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t.latitude}>
              <input
                inputMode="decimal"
                value={form.latitude ?? ''}
                onChange={set('latitude')}
                className={fieldInput}
              />
            </Field>
            <Field label={t.longitude}>
              <input
                inputMode="decimal"
                value={form.longitude ?? ''}
                onChange={set('longitude')}
                className={fieldInput}
              />
            </Field>
            <Field label={t.radius(Number(form.geofenceMetres))} hint={t.locationHint}>
              <input
                type="range"
                min={50}
                max={1000}
                step={50}
                value={form.geofenceMetres ?? '200'}
                onChange={set('geofenceMetres')}
                className="h-10 accent-navy-950"
              />
            </Field>
          </div>
          {locating === 'failed' && (
            <p className="text-caption text-signal-warn-ink">{t.noLocation}</p>
          )}
        </fieldset>

        {fields.data && fields.data.length > 0 && (
          <div className="flex flex-col gap-4 border-t border-line pt-6">
            <p className="text-body font-semibold text-ink">{en.customFields.title}</p>
            <CustomFields
              fields={fields.data}
              values={custom}
              onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))}
              problems={problemsOf(save.error)}
              idPrefix={`campus-${campus?.campusId ?? 'new'}`}
            />
          </div>
        )}
      </div>
    </FormModal>
  );
}

const PROFILES = ['school', 'affiliated_college', 'autonomous_college', 'university'] as const;

/** A school, or a college or university with its profile (rule book §12.3). */
function AddSchool({
  campus,
  onDone,
  onCancel,
}: {
  campus: CampusProfile;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [profile, setProfile] = useState<(typeof PROFILES)[number]>('school');
  const [authority, setAuthority] = useState('');
  const college = profile === 'affiliated_college' || profile === 'autonomous_college';
  const authorityCode =
    profile === 'school' ? 'CBSE' : profile === 'university' ? 'UGC' : authority;
  const add = useMutation({
    mutationFn: () =>
      api.post(`/organisation/campuses/${campus.campusId}/institutions`, {
        profile,
        name,
        authorityCode,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.addSchool}
      description={campus.name}
      size="md"
      submitLabel={t.addSchool}
      cancelLabel={en.form.cancel}
      pending={add.isPending}
      submitDisabled={name.trim().length < 2 || !/^[A-Z0-9_]{2,32}$/.test(authorityCode)}
      error={add.isError ? errorText(add.error) : null}
      onClose={onCancel}
      onSubmit={() => add.mutate()}
    >
      <ModalField label={t.institutionKind} wide>
        <select
          value={profile}
          onChange={(e) => setProfile(e.target.value as (typeof PROFILES)[number])}
          className={fieldInput}
        >
          {PROFILES.map((p) => (
            <option key={p} value={p}>
              {t.profiles[p]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.schoolName} wide>
        <input
          required
          minLength={2}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      {college ? (
        <ModalField label={t.affiliatedTo} hint={t.affiliatedHint}>
          <input
            required
            value={authority}
            onChange={(e) => setAuthority(e.target.value.toUpperCase())}
            className={fieldInput}
          />
        </ModalField>
      ) : (
        <ModalField label={profile === 'school' ? t.board : t.regulator}>
          <select disabled value={authorityCode} className={fieldInput}>
            <option>{authorityCode}</option>
          </select>
        </ModalField>
      )}
    </FormModal>
  );
}
