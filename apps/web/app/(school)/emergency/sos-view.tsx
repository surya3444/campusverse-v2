'use client';

// Raise SOS (rule book §13.9 Emergency, §16.5 step 3): one screen any staff member can reach in a
// tap. What is happening and where are enough; naming the student shows their life-saving card
// for an hour (recorded). Leaders, the nurse and the family are alerted by the server.
import type { IncidentKind, SosResult } from '@campusverse/shared-health';
import { Announcer, Button, PageHeader, Segmented, StatePanel, cx } from '@campusverse/ui';
import { useMutation } from '@tanstack/react-query';
import { Phone, Siren } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { errorText, time, useStudentSearch, type Found } from '../health/common';

const t = en.emergency;
const KINDS: IncidentKind[] = ['medical', 'injury', 'fire', 'missing_child', 'other'];

export function SosView() {
  const { can } = useMe();
  const school = useInstitution();
  const id = school.institutionId ?? null;
  const [kind, setKind] = useState<IncidentKind>('medical');
  const [where, setWhere] = useState('');
  const [text, setText] = useState('');
  const [student, setStudent] = useState<Found | null>(null);
  const found = useStudentSearch(id, student ? '' : text);
  const raise = useMutation({
    mutationFn: () =>
      api.post<SosResult>('/health/sos', {
        institutionId: id,
        kind,
        location: where,
        ...(student ? { studentId: student.personId } : {}),
      }),
  });
  const reset = () => {
    raise.reset();
    setWhere('');
    setText('');
    setStudent(null);
  };

  const header = (
    <PageHeader
      icon={Siren}
      area="rose"
      eyebrow={en.systems.groups.health}
      title={t.title}
      description={t.lead}
    />
  );
  if (!can('health.emergency.raise'))
    return (
      <div className="flex flex-col gap-6">
        {header}
        <StatePanel kind="denied" title={t.denied} body={t.deniedBody} />
      </div>
    );

  if (raise.data) {
    const r = raise.data;
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Announcer message={t.raised} />
        <div
          role="status"
          className="rounded-xl border border-signal-stop-ink/30 bg-signal-stop-tint px-5 py-4"
        >
          <p className="font-display text-lead font-semibold text-signal-stop-ink">{t.raised}</p>
          {student && <p className="text-body text-ink">{t.familyTold}</p>}
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {student && (
            <section
              aria-labelledby="sos-card"
              className="panel flex flex-col gap-1 rounded-xl p-5"
            >
              <h2 id="sos-card" className="font-display text-lead font-semibold text-ink">
                {t.card} · {student.name}
              </h2>
              {r.emergency ? (
                <>
                  <p className="text-caption text-ink-muted">
                    {t.expires(time(r.emergency.expiresAt))}
                  </p>
                  <dl className="flex flex-col divide-y divide-line">
                    <div className="flex flex-col gap-1 py-3">
                      <dt className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
                        {t.bloodGroup}
                      </dt>
                      <dd className="font-display text-[1.75rem] font-semibold text-ink">
                        {r.emergency.bloodGroup ?? t.unknown}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1 py-3">
                      <dt className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
                        {t.allergies}
                      </dt>
                      <dd className="text-body font-medium text-signal-stop-ink">
                        {r.emergency.allergies || '—'}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1 py-3">
                      <dt className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
                        {t.notes}
                      </dt>
                      <dd className="text-body text-ink">{r.emergency.responderNotes || '—'}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="text-body text-ink">{t.noRecord}</p>
              )}
            </section>
          )}
          <section aria-labelledby="sos-call" className="panel flex flex-col gap-3 rounded-xl p-5">
            <h2 id="sos-call" className="font-display text-lead font-semibold text-ink">
              {t.call}
            </h2>
            <p className="text-body text-ink">{t.emergencyNumber}</p>
            {r.partners.length === 0 ? (
              <p className="text-body text-ink-muted">{t.noPartners}</p>
            ) : (
              <ol className="flex flex-col divide-y divide-line">
                {r.partners.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">{x.name}</span>
                      <span className="text-caption text-ink-muted">
                        {en.health.partners.kinds[x.kind]}
                        {x.address ? ` · ${x.address}` : ''}
                      </span>
                    </span>
                    <a
                      href={`tel:${x.phone.replace(/[^0-9+]/g, '')}`}
                      className="tabular inline-flex shrink-0 items-center gap-2 rounded-lg border border-line px-3 py-2 text-body whitespace-nowrap font-medium text-ink hover:bg-navy-50 focus-visible:outline-2 focus-visible:outline-navy-950"
                    >
                      <Phone aria-hidden className="size-4" />
                      {x.phone}
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        <div>
          <Button variant="secondary" onClick={reset}>
            {t.another}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <form
        className="panel flex max-w-2xl flex-col gap-5 rounded-xl p-5"
        onSubmit={(e) => {
          e.preventDefault();
          raise.mutate();
        }}
      >
        <div className="flex flex-col gap-2">
          <span className="text-caption font-medium text-ink">{t.kind}</span>
          <Segmented
            label={t.kind}
            value={kind}
            onChange={setKind}
            options={KINDS.map((k) => ({ value: k, label: en.health.incidents.kinds[k] ?? k }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sos-where" className="text-caption font-medium text-ink">
            {t.where}
          </label>
          <input
            id="sos-where"
            className={fieldInput}
            value={where}
            placeholder={t.wherePlaceholder}
            maxLength={200}
            onChange={(e) => setWhere(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sos-student" className="text-caption font-medium text-ink">
            {t.student}
          </label>
          {student ? (
            <span className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
              <span className="text-body text-ink">{student.name}</span>
              <Button variant="quiet" size="sm" onClick={() => setStudent(null)}>
                {t.remove}
              </Button>
            </span>
          ) : (
            <input
              id="sos-student"
              className={fieldInput}
              value={text}
              autoComplete="off"
              placeholder={t.search}
              aria-describedby="sos-student-hint"
              onChange={(e) => setText(e.target.value)}
            />
          )}
          <p id="sos-student-hint" className="text-caption text-ink-muted">
            {t.studentHint}
          </p>
          {!student && text.trim().length >= 2 && (
            <ul className="flex flex-col" aria-label={t.student}>
              {(found.data ?? []).slice(0, 6).map((s) => (
                <li key={s.personId}>
                  <button
                    type="button"
                    onClick={() => setStudent(s)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-paper focus-visible:outline-2 focus-visible:outline-navy-950"
                  >
                    <span className="text-body text-ink">{s.name}</span>
                    <span className="text-caption text-ink-muted">{s.placement}</span>
                  </button>
                </li>
              ))}
              {(found.data?.length === 0 || found.error) && (
                <li className="text-body text-ink-muted">{t.noMatch}</li>
              )}
            </ul>
          )}
        </div>
        {raise.error && (
          <p role="alert" className="text-body text-signal-stop-ink">
            {errorText(raise.error)}
          </p>
        )}
        <Button
          type="submit"
          variant="danger"
          size="lg"
          className={cx('self-start')}
          disabled={!id || where.trim().length < 2 || raise.isPending}
        >
          <Siren aria-hidden />
          {raise.isPending ? t.raising : t.raise}
        </Button>
      </form>
    </div>
  );
}
