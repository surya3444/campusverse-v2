'use client';

import type { StudentRecord } from '@campusverse/people-records';
import { Announcer, Button, FormModal, ModalField, Pill, StatePanel } from '@campusverse/ui';
import { RecordStamp } from '../../common/activity';
import { ConsentPanel } from './consent-panel';
import { DetailsPanel } from './details-panel';
import { ProfileHero, ProfileTabsList } from '../../common/profile360';
import {
  StudentAcademics,
  StudentFees,
  StudentOverview,
  StudentStats,
  useStudent360,
} from './student-360';
import { useInstitution } from '../../attendance/shared';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BedDouble,
  Bus,
  Cake,
  Eye,
  FileBadge,
  GraduationCap,
  IdCard,
  IndianRupee,
  MapPin,
  Phone,
  ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';
import { Tabs } from 'radix-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { formatDate } from '../../setup/shared';
import { ReasonDialog } from '../../reason-dialog';
import { STATUS_TONE } from '../students-list';

const t = en.students;
const errorText = (e: unknown): string =>
  t.errors[e instanceof ApiFailure ? e.code : 'error'] ?? t.errors.error ?? '';

export function StudentRecordView({ id }: { id: string }) {
  const qc = useQueryClient();
  const school = useInstitution();
  const { can } = useMe();
  const record = useQuery({
    queryKey: ['student', id],
    queryFn: () => api.get<StudentRecord>(`/people/students/${id}`),
  });
  const [message, setMessage] = useState<string | null>(null);
  const d = useStudent360(id, school.institutionId ?? null);
  const onSaved = () => {
    void record.refetch();
    void qc.invalidateQueries({ queryKey: ['stamps'] });
  };

  if (record.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (record.isError) {
    const notFound = record.error instanceof ApiFailure && record.error.status === 404;
    const denied = record.error instanceof ApiFailure && record.error.status === 403;
    return denied ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind={notFound ? 'empty' : 'error'}
        title={notFound ? t.notFound : errorText(record.error)}
      />
    );
  }
  const r = record.data;

  const p = t.p360;
  const placement = r.placements[0];
  const years = r.person.dateOfBirth
    ? Math.floor(
        (Date.now() - new Date(`${r.person.dateOfBirth}T00:00:00Z`).getTime()) / (365.25 * 864e5),
      )
    : null;
  const bus = d.services.data?.transport?.[0];
  const stay = d.services.data?.hostel?.stay;
  const tabs = (
    ['overview', 'personal', 'guardians', 'academics', 'fees', 'documents', 'history'] as const
  ).filter(
    (k) =>
      (k !== 'guardians' || r.guardians) &&
      (k !== 'documents' || r.documents) &&
      (k !== 'history' || r.timeline) &&
      (k !== 'fees' || d.fees.data !== null) &&
      (k !== 'academics' || d.results.data !== null),
  );
  const primary = r.guardians?.find((g) => g.primary) ?? r.guardians?.[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/students"
          className="inline-flex items-center gap-2 rounded-lg px-1 text-body font-medium text-ink hover:text-navy-950"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {p.back}
        </Link>
        <span className="flex-1" />
        {d.fees.data && (
          <Link
            href={`/fees/students/${r.person.id}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-body font-medium text-ink shadow-[var(--shadow-card)] hover:bg-navy-50"
          >
            <IndianRupee aria-hidden className="size-4" />
            {p.actions.collect}
          </Link>
        )}
        <Link
          href={`/certificates?student=${r.person.id}`}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-body font-medium text-ink shadow-[var(--shadow-card)] hover:bg-navy-50"
        >
          <FileBadge aria-hidden className="size-4" />
          {p.actions.certificate}
        </Link>
        {can('school.certificate.request') && placement && (
          <a
            href={`/api/v1/school/certificates/id-cards?studentId=${r.person.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-body font-medium text-ink shadow-[var(--shadow-card)] hover:bg-navy-50"
          >
            <IdCard aria-hidden className="size-4" />
            {p.actions.idCard}
          </a>
        )}
      </div>

      <ProfileHero
        label={placement?.displayLabel ?? p.student}
        labelIcon={GraduationCap}
        photo={
          <ImageUpload
            compact
            label={en.myProfile.photo}
            name={r.person.name}
            src={`/api/v1/people/${r.person.id}/photo`}
            currentFileId={r.person.photoFileId}
            uploadPath={`/people/${r.person.id}/photo`}
            canEdit={r.can.update}
            onChanged={() => void record.refetch()}
          />
        }
        name={r.person.name}
        status={
          <Pill tone={STATUS_TONE[r.person.status] ?? 'neutral'}>
            {t.statuses[r.person.status]}
          </Pill>
        }
        subtitle={
          r.placements
            .map((x) => [x.displayLabel, x.reference && t.admissionShort(x.reference)])
            .flat()
            .filter(Boolean)
            .join(' · ') || undefined
        }
        contact={
          primary?.phone ? (
            <a
              href={`tel:${primary.phone}`}
              className="inline-flex items-center gap-1.5 hover:text-ink"
            >
              <Phone aria-hidden className="size-3.5" />
              {primary.phone} · {primary.name}
            </a>
          ) : undefined
        }
        stamp={<RecordStamp id={r.person.id} />}
        chips={[
          ...(placement?.reference ? [{ icon: IdCard, label: placement.reference }] : []),
          ...(years !== null ? [{ icon: Cake, label: p.chips.age(years, r.person.gender) }] : []),
          stay
            ? { icon: BedDouble, label: p.chips.hostel(stay.room) }
            : bus
              ? { icon: Bus, label: p.chips.bus(bus.route) }
              : { icon: MapPin, label: p.chips.dayScholar },
        ]}
      />

      <StudentStats d={d} />

      <Tabs.Root defaultValue="overview" className="flex flex-col gap-5">
        <ProfileTabsList
          label={r.person.name}
          tabs={tabs.map((k) => ({
            value: k,
            label:
              k === 'guardians' || k === 'documents' || k === 'history'
                ? (t.tabs[k] ?? k)
                : (p.tabs[k] ?? k),
          }))}
        />

        <Tabs.Content value="overview">
          <StudentOverview record={r} d={d} />
        </Tabs.Content>
        <Tabs.Content value="personal" className="flex flex-col gap-6">
          <Overview record={r} onMessage={setMessage} />
          {r.details && (
            <DetailsPanel
              studentId={r.person.id}
              details={r.details}
              canEdit={r.can.update}
              onMessage={setMessage}
            />
          )}
          {r.custom && (
            <OwnFields
              entity="student"
              saved={r.custom}
              canEdit={r.can.update}
              path={`/people/students/${r.person.id}`}
              wrap={(custom) => ({ custom })}
              idPrefix="student"
              onSaved={() => onSaved()}
            />
          )}
        </Tabs.Content>
        <Tabs.Content value="academics">
          <StudentAcademics record={r} d={d} />
        </Tabs.Content>
        <Tabs.Content value="fees">
          <StudentFees studentId={r.person.id} d={d} />
        </Tabs.Content>
        {r.guardians && (
          <Tabs.Content value="guardians" className="flex flex-col gap-6">
            <Guardians record={r} onMessage={setMessage} />
            <ConsentPanel studentId={r.person.id} onMessage={setMessage} />
          </Tabs.Content>
        )}
        {r.documents && (
          <Tabs.Content value="documents" className="flex flex-col gap-6">
            <DocumentsPanel paths={personDocuments(r.person.id)} folders={STUDENT_FOLDERS} />
            {r.documents.length > 0 && (
              <section className="panel" aria-label={t.checklist}>
                <h2 className="border-b border-line px-5 py-3.5 text-body font-semibold text-ink">
                  {t.checklist}
                </h2>
                {
                  <ul className="divide-y divide-line">
                    {r.documents.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                        <span className="min-w-0 flex-1 text-body text-ink">
                          {d.kind.replaceAll('_', ' ')}
                        </span>
                        <span className="text-caption text-ink-muted">
                          {t.requirement[d.requirement]}
                        </span>
                        <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-caption font-medium text-navy-700">
                          {t.docStatus[d.status]}
                        </span>
                        {d.note && (
                          <span className="basis-full text-caption text-ink-muted">{d.note}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                }
              </section>
            )}
          </Tabs.Content>
        )}
        {r.timeline && (
          <Tabs.Content value="history" className="grid gap-6 lg:grid-cols-2">
            <section className="panel">
              <h2 className="border-b border-line px-5 py-3.5 text-body font-semibold text-ink">
                {t.names}
              </h2>
              <ul className="divide-y divide-line">
                {r.names.map((n, i) => (
                  <li key={i} className="flex flex-col px-5 py-3">
                    <span className="text-body text-ink">{n.legalName}</span>
                    <span className="text-caption text-ink-muted">
                      {t.nameSource[n.source]} · {formatDate(n.recordedAt.slice(0, 10))}
                      {n.reason ? ` · ${n.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel">
              <h2 className="border-b border-line px-5 py-3.5 text-body font-semibold text-ink">
                {t.activity}
              </h2>
              <ul className="divide-y divide-line">
                {r.timeline.map((e, i) => (
                  <li key={i} className="flex flex-col px-5 py-3">
                    <span className="text-body text-ink">{t.event(e.action, e.detail)}</span>
                    <span className="text-caption text-ink-muted">
                      {formatDate(e.at.slice(0, 10))}
                      {e.reason ? ` · ${e.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </Tabs.Content>
        )}
      </Tabs.Root>
      <Announcer message={message} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-5 py-3 sm:grid-cols-[200px_1fr]">
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="text-body text-ink">{children}</dd>
    </div>
  );
}

function Overview({
  record: r,
  onMessage,
}: {
  record: StudentRecord;
  onMessage: (m: string) => void;
}) {
  const [revealing, setRevealing] = useState<IdKind | null>(null);
  const [shown, setShown] = useState<{ kind: IdKind; value: string } | null>(null);
  const [editing, setEditing] = useState(false);
  // Revealed values disappear again after 30 seconds.
  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), 30_000);
    return () => clearTimeout(id);
  }, [shown]);

  const identifier = (kind: IdKind, maskedValue: string | null, extra?: string) => (
    <span className="flex flex-wrap items-center gap-3">
      <span className="tabular">
        {shown?.kind === kind ? shown.value : (maskedValue ?? t.notRecorded)}
      </span>
      {extra && <span className="text-caption text-ink-muted">{extra}</span>}
      {r.can.reveal && maskedValue && shown?.kind !== kind && (
        <Button variant="quiet" size="sm" onClick={() => setRevealing(kind)}>
          <Eye aria-hidden className="size-3.5" />
          {t.reveal}
        </Button>
      )}
      {shown?.kind === kind && <span className="text-caption text-ink-muted">{t.revealedFor}</span>}
    </span>
  );

  return (
    <section className="panel">
      <dl className="divide-y divide-line">
        <Row label={t.dob}>{r.person.dateOfBirth ? formatDate(r.person.dateOfBirth) : '—'}</Row>
        <Row label={t.gender}>{r.person.gender ? t.genders[r.person.gender] : '—'}</Row>
        <Row label={t.belongsTo}>
          <ul className="flex flex-col gap-1">
            {r.memberships.map((m, i) => (
              <li key={i}>
                {m.institutionName}{' '}
                <span className="text-caption text-ink-muted">
                  · {m.until ? t.until(formatDate(m.until)) : t.since(formatDate(m.from))}
                </span>
              </li>
            ))}
          </ul>
        </Row>
        <Row label={t.apaar}>
          {identifier(
            'apaar',
            r.identifiers.apaar.masked,
            r.identifiers.apaar.masked
              ? undefined
              : `${t.apaarStatus[r.identifiers.apaar.status]}${r.identifiers.apaar.note ? ` · ${r.identifiers.apaar.note}` : ''}`,
          )}
        </Row>
        <Row label={t.aadhaar}>{identifier('aadhaar', r.identifiers.aadhaar.masked)}</Row>
        <Row label={t.pen}>
          <span className="tabular">{r.identifiers.pen ?? t.notRecorded}</span>
        </Row>
        <Row label={t.abc}>{identifier('abc', r.identifiers.abc.masked)}</Row>
      </dl>
      {r.can.update && (
        <div className="border-t border-line px-5 py-3">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <IdCard aria-hidden />
            {t.editIds}
          </Button>
        </div>
      )}
      {editing && (
        <IdentifiersForm
          record={r}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            onMessage(t.idsForm.saved);
          }}
        />
      )}
      {revealing && (
        <ReasonDialog
          cancel={t.cancel}
          errorText={errorText}
          title={t.revealTitle(t[revealing])}
          hint={t.revealHint}
          label={t.revealReason}
          action={t.revealAction}
          onClose={() => setRevealing(null)}
          submit={async (reason) => {
            const { value } = await api.post<{ value: string }>(
              `/people/students/${r.person.id}/reveal`,
              { kind: revealing, reason },
            );
            setShown({ kind: revealing, value });
            onMessage(t.revealHint);
          }}
        />
      )}
    </section>
  );
}

type IdKind = 'aadhaar' | 'apaar' | 'abc';

/** One form for the learner's identifiers (rule book §13.5): each changed one is saved in turn. */
function IdentifiersForm({
  record: r,
  onClose,
  onDone,
}: {
  record: StudentRecord;
  onClose: () => void;
  onDone: () => void;
}) {
  const f = t.idsForm;
  const qc = useQueryClient();
  const [apaarStatus, setApaarStatus] = useState(r.identifiers.apaar.status);
  const [apaarId, setApaarId] = useState('');
  const [apaarNote, setApaarNote] = useState(r.identifiers.apaar.note ?? '');
  const [aadhaar, setAadhaar] = useState('');
  const [pen, setPen] = useState(r.identifiers.pen ?? '');
  const [abc, setAbc] = useState('');
  const id = r.person.id;
  const apaarChanged =
    apaarStatus === 'present'
      ? apaarId.trim() !== ''
      : apaarStatus !== r.identifiers.apaar.status ||
        apaarNote.trim() !== (r.identifiers.apaar.note ?? '');
  const penChanged = pen.trim() !== (r.identifiers.pen ?? '');
  const save = useMutation({
    mutationFn: async () => {
      if (apaarChanged)
        await api.post(
          `/people/students/${id}/apaar`,
          apaarStatus === 'present'
            ? { status: 'present', id: apaarId }
            : { status: apaarStatus, note: apaarNote },
        );
      if (aadhaar.trim()) await api.post(`/people/students/${id}/aadhaar`, { aadhaar });
      if (penChanged) await api.post(`/people/students/${id}/pen`, { pen: pen.trim() || null });
      if (abc.trim()) await api.post(`/people/students/${id}/abc`, { abc });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['student', id] });
      onDone();
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['student', id] }),
  });
  const nothing = !apaarChanged && !aadhaar.trim() && !penChanged && !abc.trim();
  return (
    <FormModal
      title={f.title}
      description={f.lead}
      submitLabel={f.save}
      cancelLabel={f.cancel}
      pending={save.isPending}
      submitDisabled={
        nothing || (apaarStatus !== 'present' && apaarChanged && apaarNote.trim().length < 3)
      }
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={f.apaarStatus}>
        <select
          className={fieldInput}
          value={apaarStatus}
          onChange={(e) => setApaarStatus(e.target.value)}
        >
          {(['present', 'refused', 'not_generated'] as const).map((s) => (
            <option key={s} value={s}>
              {t.apaarStatus[s]}
            </option>
          ))}
        </select>
      </ModalField>
      {apaarStatus === 'present' ? (
        <ModalField label={f.apaarId} hint={r.identifiers.apaar.masked ? f.keep : undefined}>
          <input
            className={fieldInput}
            inputMode="numeric"
            autoComplete="off"
            value={apaarId}
            maxLength={20}
            onChange={(e) => setApaarId(e.target.value)}
          />
        </ModalField>
      ) : (
        <ModalField label={f.apaarNote}>
          <input
            className={fieldInput}
            value={apaarNote}
            maxLength={500}
            onChange={(e) => setApaarNote(e.target.value)}
          />
        </ModalField>
      )}
      <ModalField label={f.aadhaar} hint={r.identifiers.aadhaar.masked ? f.keep : undefined}>
        <input
          className={fieldInput}
          inputMode="numeric"
          autoComplete="off"
          value={aadhaar}
          maxLength={20}
          onChange={(e) => setAadhaar(e.target.value)}
        />
      </ModalField>
      <ModalField label={f.abc} hint={r.identifiers.abc.masked ? f.keep : undefined}>
        <input
          className={fieldInput}
          inputMode="numeric"
          autoComplete="off"
          value={abc}
          maxLength={20}
          onChange={(e) => setAbc(e.target.value)}
        />
      </ModalField>
      <ModalField label={f.pen} hint={f.penHint} wide>
        <input
          className={fieldInput}
          inputMode="numeric"
          autoComplete="off"
          value={pen}
          maxLength={20}
          onChange={(e) => setPen(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function Guardians({
  record: r,
  onMessage,
}: {
  record: StudentRecord;
  onMessage: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [restricting, setRestricting] = useState<string | null>(null);
  const lift = useMutation({
    mutationFn: (linkId: string) =>
      api.post(`/people/guardian-links/${linkId}`, { restriction: null }),
    onSuccess: async () => {
      onMessage(t.liftedDone);
      await qc.invalidateQueries({ queryKey: ['student', r.person.id] });
    },
  });
  if (!r.guardians || r.guardians.length === 0)
    return <StatePanel kind="empty" title={t.noGuardians} />;

  return (
    <section className="panel">
      <ul className="divide-y divide-line">
        {r.guardians.map((g) => (
          <li key={g.linkId} className="flex flex-col gap-3 px-5 py-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-body font-medium text-ink">
                  {g.name} <span className="font-normal text-ink-muted">· {g.relationship}</span>
                </span>
                <span className="tabular text-caption text-ink-muted">{g.phone ?? '—'}</span>
                <span className="flex flex-wrap gap-1.5">
                  {g.primary && (
                    <span className="rounded-full bg-navy-50 px-2 py-0.5 text-caption text-navy-700">
                      {t.primary}
                    </span>
                  )}
                  {g.feePayer && (
                    <span className="rounded-full bg-navy-50 px-2 py-0.5 text-caption text-navy-700">
                      {t.feePayer}
                    </span>
                  )}
                  {!g.canLogin && (
                    <span className="rounded-full bg-paper px-2 py-0.5 text-caption text-ink-muted">
                      {t.noLogin}
                    </span>
                  )}
                  {g.restricted && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-signal-stop-tint px-2 py-0.5 text-caption text-signal-stop-ink">
                      <ShieldAlert aria-hidden className="size-3" />
                      {t.restricted(g.restricted.reason)}
                    </span>
                  )}
                </span>
              </div>
              {r.can.update &&
                (g.restricted ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => lift.mutate(g.linkId)}
                    disabled={lift.isPending}
                  >
                    {t.lift}
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setRestricting(g.linkId)}>
                    {t.restrict}
                  </Button>
                ))}
            </div>
            <OwnFields
              entity="guardian"
              saved={g.custom}
              canEdit={r.can.update}
              path={`/people/students/${r.person.id}/guardians/${g.personId}/fields`}
              wrap={(custom) => custom}
              idPrefix={`guardian-${g.personId}`}
              compact
              onSaved={() => void qc.invalidateQueries({ queryKey: ['student', r.person.id] })}
            />
          </li>
        ))}
      </ul>
      {restricting && (
        <ReasonDialog
          cancel={t.cancel}
          errorText={errorText}
          title={t.restrictTitle}
          hint={t.restrictHint}
          label={t.restrictReason}
          action={t.restrictConfirm}
          onClose={() => setRestricting(null)}
          submit={async (reason) => {
            await api.post(`/people/guardian-links/${restricting}`, { restriction: { reason } });
            onMessage(t.restrictedDone);
            await qc.invalidateQueries({ queryKey: ['student', r.person.id] });
          }}
        />
      )}
    </section>
  );
}

/** Small confirm step that asks for a reason: reveals and restrictions are recorded with it. */

const STUDENT_FOLDERS = ['identity', 'academic', 'medical', 'transfer', 'other'] as const;

/** The owner's own fields for a student or a guardian, edited where they are shown. */
function OwnFields({
  entity,
  saved,
  canEdit,
  path,
  wrap,
  idPrefix,
  compact = false,
  onSaved,
}: {
  entity: 'student' | 'guardian';
  saved: Values;
  canEdit: boolean;
  path: string;
  wrap: (custom: Values) => unknown;
  idPrefix: string;
  compact?: boolean;
  onSaved: () => void;
}) {
  const fields = useFields(entity);
  const [values, setValues] = useState<Values>(saved);
  useEffect(() => setValues(saved), [saved]);
  const changed = fields.data ? changedValues(fields.data, saved, values) : {};
  const dirty = Object.keys(changed).length > 0;
  const save = useMutation({ mutationFn: () => api.post(path, wrap(changed)), onSuccess: onSaved });
  if (!fields.data || fields.data.length === 0) return null;
  const problems =
    save.error instanceof ApiFailure && save.error.code === 'values'
      ? ((save.error.details as { problems?: Record<string, string> } | null)?.problems ?? {})
      : {};
  const body = (
    <div className="flex flex-col gap-4">
      <CustomFields
        fields={fields.data}
        values={values}
        onChange={(k, v) => setValues((x) => ({ ...x, [k]: v }))}
        problems={problems}
        disabled={!canEdit}
        idPrefix={idPrefix}
      />
      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          <span role="status" className="flex-1 text-caption text-ink-muted">
            {save.isSuccess && !dirty ? en.organisationAdmin.saved : ''}
          </span>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {en.settings.save}
          </Button>
        </div>
      )}
    </div>
  );
  return compact ? (
    <details className="rounded-xl bg-paper/70 px-4 py-3">
      <summary className="cursor-pointer text-body font-medium text-ink">
        {en.customFields.title}
      </summary>
      <div className="pt-4">{body}</div>
    </details>
  ) : (
    <section aria-label={en.customFields.title} className="panel flex flex-col gap-4 p-5">
      <h2 className="text-body font-semibold text-ink">{en.customFields.title}</h2>
      {body}
    </section>
  );
}
