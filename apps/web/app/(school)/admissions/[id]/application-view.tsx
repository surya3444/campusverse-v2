'use client';

import type { ApplicationDetail, Enrolled } from '@campusverse/school-admissions';
import { Announcer, Button, Section, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { rupees } from '../../../../lib/money';
import { en } from '../../../../messages/en';
import { ReasonDialog } from '../../reason-dialog';
import { RecordStamp } from '../../common/activity';
import { CustomFields, changedValues, useFields, type Values } from '../../common/custom-fields';
import { DocumentsPanel } from '../../common/documents';
import { ImageUpload } from '../../common/image-upload';
import { admissionError } from '../pipeline-view';

const t = en.admissions;
const field =
  'h-9 rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';
const MOVES: Record<string, string[]> = {
  enquiry: ['contacted', 'applied', 'lost'],
  contacted: ['applied', 'lost'],
  applied: ['documents_pending', 'under_review', 'waitlisted', 'rejected', 'withdrawn'],
  documents_pending: ['under_review', 'waitlisted', 'rejected', 'withdrawn'],
  under_review: ['documents_pending', 'waitlisted', 'rejected', 'withdrawn'],
  offered: ['withdrawn', 'lost'],
  waitlisted: ['under_review', 'withdrawn', 'lost'],
  confirmed: ['withdrawn'],
};
const CLOSING = new Set(['lost', 'withdrawn', 'rejected']);
const APPLICANT_FOLDERS = ['identity', 'academic', 'medical', 'transfer', 'other'] as const;

export function ApplicationView({ id }: { id: string }) {
  const qc = useQueryClient();
  const key = ['application', id];
  const app = useQuery({
    queryKey: key,
    queryFn: () => api.get<ApplicationDetail>(`/school/admissions/applications/${id}`),
  });
  const [message, setMessage] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [closing, setClosing] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [orderRef, setOrderRef] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [enrolled, setEnrolled] = useState<Enrolled | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['admissions'] });
  };
  const move = useMutation({
    mutationFn: (v: { to: string; reason?: string }) =>
      api.post(`/school/admissions/applications/${id}/move`, v),
    onSuccess: () => {
      setTo('');
      refresh();
    },
  });
  const offer = useMutation({
    mutationFn: () =>
      api.post<{ expiresOn: string }>(`/school/admissions/applications/${id}/offer`),
    onSuccess: (r) => {
      setMessage(t.offered(r.expiresOn));
      refresh();
    },
  });
  const confirm = useMutation({
    mutationFn: () => api.post(`/school/admissions/applications/${id}/confirm`),
    onSuccess: refresh,
  });
  const enrol = useMutation({
    mutationFn: () =>
      api.post<Enrolled>(`/school/admissions/applications/${id}/enrol`, { sectionId, from }),
    onSuccess: (r) => {
      setEnrolled(r);
      setMessage(t.enrolled(r.admissionNumber));
      refresh();
    },
  });

  if (app.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (app.isError) {
    return app.error instanceof ApiFailure && app.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={admissionError(app.error)} />
    );
  }
  const a = app.data;
  const error = move.error ?? offer.error ?? confirm.error ?? enrol.error;
  const age = a.age;
  const ageText =
    age.status === 'ok' || age.status === 'too_young' || age.status === 'too_old'
      ? t.ages[age.status](age.years, age.cutOffDate)
      : t.ages[age.status];
  const ageBad = (age.status === 'too_young' || age.status === 'too_old') && !a.ageOverrideReason;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/admissions"
        className="inline-flex items-center gap-1.5 self-start text-body text-navy-950 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.back}
      </Link>
      <div className="panel flex flex-wrap items-center gap-5 p-5 motion-safe:animate-rise">
        <ImageUpload
          compact
          label={en.myProfile.photo}
          name={a.childName}
          src={`/api/v1/school/admissions/applications/${id}/photo`}
          currentFileId={a.photoFileId}
          uploadPath={`/school/admissions/applications/${id}/photo`}
          canEdit={a.state !== 'enrolled'}
          onChanged={refresh}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-title font-semibold text-ink">{a.childName}</h1>
          <p className="text-body text-ink-muted">
            {a.className} · {a.yearLabel} · {t.categories[a.category]} · {t.sources[a.source]}
          </p>
          <RecordStamp id={id} />
        </div>
        <span className="rounded-full bg-navy-50 px-3 py-1 text-caption font-medium text-navy-700">
          {t.states[a.state]}
        </span>
      </div>

      {a.siblings.length > 0 && (
        <p className="rounded-md bg-signal-warn-tint px-4 py-2 text-body text-signal-warn-ink">
          {t.siblingFound(a.siblings.map((s) => s.studentName).join(', '))}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <dl className="panel grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-5 text-body">
          <dt className="text-ink-muted">{t.dateOfBirth}</dt>
          <dd className="text-ink">{a.dateOfBirth ?? '—'}</dd>
          <dt className="text-ink-muted">{t.guardian}</dt>
          <dd className="text-ink">
            {a.guardianName} ({t.relationships[a.guardianRelationship] ?? a.guardianRelationship})
          </dd>
          <dt className="text-ink-muted">{t.guardianPhone}</dt>
          <dd className="tabular text-ink">{a.guardianPhone}</dd>
          <dt className="text-ink-muted">{t.age}</dt>
          <dd className={cx(ageBad ? 'text-signal-stop-ink' : 'text-ink')}>
            {ageText}
            {a.ageOverrideReason && (
              <span className="block text-caption text-ink-muted">
                {t.override(a.ageOverrideReason, a.ageOrderRef ?? '')}
              </span>
            )}
            {ageBad && (
              <Button size="sm" variant="quiet" onClick={() => setOverride(true)}>
                {t.overrideTitle}
              </Button>
            )}
          </dd>
          <dt className="text-ink-muted">{t.seatsLabel}</dt>
          <dd className="text-ink">{t.seatsLeft(a.seatsLeft)}</dd>
        </dl>
        <section aria-labelledby="fees" className="panel flex flex-col gap-2 p-5">
          <h2 id="fees" className="text-body font-semibold text-ink">
            {t.fees}
          </h2>
          {a.fees.length === 0 ? (
            <p className="text-body text-signal-warn-ink">{t.noFees}</p>
          ) : (
            a.fees.map((f) => (
              <div key={f.planId} className="flex flex-col gap-1 text-body">
                <span className="flex justify-between font-medium text-ink">
                  {f.name}{' '}
                  <span className="tabular">
                    {rupees(f.totalPaise)} {t.perYear}
                  </span>
                </span>
                {f.lines.map((l) => (
                  <span key={l.head} className="flex justify-between text-caption text-ink-muted">
                    {l.head} <span className="tabular">{rupees(l.amountPaise)}</span>
                  </span>
                ))}
                {f.instalments.map((i) => (
                  <span key={i.label} className="flex justify-between text-caption text-ink-muted">
                    {i.label} · {i.dueOn} <span className="tabular">{rupees(i.amountPaise)}</span>
                  </span>
                ))}
              </div>
            ))
          )}
        </section>
      </div>

      {enrolled ? (
        <section className="panel flex flex-col gap-3 p-5">
          <p className="text-body font-medium text-signal-go-ink">
            {t.enrolled(enrolled.admissionNumber)}
          </p>
          <p className="text-body text-ink">
            {t.enrolledIn(enrolled.sectionLabel, enrolled.rollNumber)} {t.familyTold}
          </p>
          <h2 className="text-body font-semibold text-ink">{t.handover}</h2>
          <ul className="list-inside list-disc text-body text-ink">
            {enrolled.handover.map((h) => (
              <li key={h}>{t.tasks[h] ?? h}</li>
            ))}
          </ul>
          <Link
            href={`/students/${enrolled.studentId}`}
            className="self-start text-body font-medium text-navy-950 hover:underline"
          >
            {t.openRecord}
          </Link>
        </section>
      ) : (
        <div className="panel flex flex-wrap items-end gap-3 p-5">
          {(MOVES[a.state] ?? []).length > 0 && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-ink">{t.move}</span>
                <select value={to} onChange={(e) => setTo(e.target.value)} className={field}>
                  <option value="">—</option>
                  {(MOVES[a.state] ?? []).map((s) => (
                    <option key={s} value={s}>
                      {t.states[s]}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="secondary"
                disabled={!to || move.isPending}
                onClick={() => (CLOSING.has(to) ? setClosing(to) : move.mutate({ to }))}
              >
                {t.moveAction}
              </Button>
            </>
          )}
          <span className="flex-1" />
          {['applied', 'documents_pending', 'under_review', 'waitlisted'].includes(a.state) && (
            <Button disabled={offer.isPending} onClick={() => offer.mutate()}>
              {t.offer}
            </Button>
          )}
          {a.state === 'offered' && (
            <Button disabled={confirm.isPending} onClick={() => confirm.mutate()}>
              {t.confirm}
            </Button>
          )}
          {a.state === 'confirmed' && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-ink">{t.section}</span>
                <select
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  className={field}
                >
                  <option value="">—</option>
                  {a.sections.map((s) => (
                    <option key={s.sectionId} value={s.sectionId}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-ink">{t.joiningDate}</span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className={field}
                />
              </label>
              <Button disabled={!sectionId || enrol.isPending} onClick={() => enrol.mutate()}>
                {t.enrol}
              </Button>
            </>
          )}
          {a.state === 'enrolled' && a.studentId && (
            <Link
              href={`/students/${a.studentId}`}
              className="text-body font-medium text-navy-950 hover:underline"
            >
              {t.openRecord}
            </Link>
          )}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink"
        >
          {admissionError(error)}
        </p>
      )}

      <AdmissionFields id={id} saved={a.custom} onSaved={refresh} />

      <section aria-labelledby="papers" className="flex flex-col gap-3">
        <h2 id="papers" className="text-lead font-semibold text-ink">
          {t.papers}
        </h2>
        <p className="-mt-2 text-body text-ink-muted">
          {a.state === 'enrolled' ? t.papersMoved : t.papersLead}
        </p>
        <DocumentsPanel
          canChange={a.state !== 'enrolled'}
          folders={APPLICANT_FOLDERS}
          paths={{
            list: `/school/admissions/applications/${id}/documents`,
            upload: `/school/admissions/applications/${id}/documents`,
            check: (d) => `/school/admissions/applications/documents/${d}/check`,
            file: (d) => `/api/v1/school/admissions/applications/documents/${d}/file`,
          }}
        />
      </section>

      <section aria-labelledby="history" className="flex flex-col gap-2">
        <h2 id="history" className="text-body font-semibold text-ink">
          {t.history}
        </h2>
        <ol className="panel divide-y divide-line">
          {a.history.map((h, i) => (
            <li key={i} className="flex flex-wrap gap-3 px-5 py-2.5 text-body">
              <span className="flex-1 text-ink">
                {t.states[h.to]}
                {h.reason && <span className="text-ink-muted"> · {h.reason}</span>}
              </span>
              <span className="text-caption text-ink-muted">
                {h.by ?? ''} · {h.at.slice(0, 16).replace('T', ' ')}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {closing && (
        <ReasonDialog
          title={t.reasonTitle(t.states[closing] ?? closing)}
          hint={t.reasonHint}
          label={t.reason}
          action={t.moveAction}
          cancel={en.fees.cancel}
          minLength={3}
          errorText={admissionError}
          onClose={() => setClosing(null)}
          submit={async (reason) => {
            await move.mutateAsync({ to: closing, reason });
          }}
        />
      )}
      {override && (
        <ReasonDialog
          title={t.overrideTitle}
          hint={t.overrideHint}
          label={t.overrideReason}
          action={t.overrideAction}
          cancel={en.fees.cancel}
          minLength={3}
          errorText={admissionError}
          onClose={() => setOverride(false)}
          submit={async (reason) => {
            await api.post(`/school/admissions/applications/${id}/update`, {
              ageOverride: { reason, orderRef },
            });
            refresh();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.orderRef}</span>
            <input
              required
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
              className={field}
            />
          </label>
        </ReasonDialog>
      )}
      <Announcer message={message} />
    </div>
  );
}

/** The owner's own admission questions for this application. */
function AdmissionFields({
  id,
  saved,
  onSaved,
}: {
  id: string;
  saved: Values;
  onSaved: () => void;
}) {
  const fields = useFields('admission');
  const [values, setValues] = useState<Values>(saved);
  useEffect(() => setValues(saved), [saved]);
  const changed = fields.data ? changedValues(fields.data, saved, values) : {};
  const save = useMutation({
    mutationFn: () => api.post(`/school/admissions/applications/${id}/update`, { custom: changed }),
    onSuccess: onSaved,
  });
  if (!fields.data || fields.data.length === 0) return null;
  const problems =
    save.error instanceof ApiFailure && save.error.code === 'values'
      ? ((save.error.details as { problems?: Record<string, string> } | null)?.problems ?? {})
      : {};
  return (
    <Section
      title={en.customFields.title}
      footer={
        <>
          <span role="status" className="flex-1">
            {save.isSuccess && Object.keys(changed).length === 0 ? en.organisationAdmin.saved : ''}
          </span>
          <Button
            disabled={Object.keys(changed).length === 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {en.settings.save}
          </Button>
        </>
      }
    >
      <CustomFields
        fields={fields.data}
        values={values}
        onChange={(k, v) => setValues((x) => ({ ...x, [k]: v }))}
        problems={problems}
        idPrefix="admission"
      />
    </Section>
  );
}
