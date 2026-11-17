'use client';

// A student's consent, purpose by purpose (rule book §13.4 Consent at Entry, §16.5): each
// guardian's latest decision, and the office recording a paper form.
import type { StudentConsent } from '@campusverse/platform-consent';
import {
  Button,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { fieldInput } from '../../common/custom-fields';
import { useMe } from '../../common/me';

const t = en.students.consent;
const purposeName = (p: string) => en.privacy.purposes[p]?.[0] ?? p.replaceAll('_', ' ');
const day = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
type Guardian = StudentConsent['guardians'][number];

export function ConsentPanel({
  studentId,
  onMessage,
}: {
  studentId: string;
  onMessage: (m: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [checking, setChecking] = useState<{
    kind: 'verify' | 'revoke';
    guardian: Guardian;
  } | null>(null);
  const canVerify = useMe().can('platform.consent.verify_guardian');
  const q = useQuery({
    queryKey: ['student-consent', studentId],
    queryFn: () => api.get<StudentConsent>(`/consent/students/${studentId}`),
  });
  if (q.error instanceof ApiFailure && q.error.status === 403) return null;
  return (
    <Section
      id="student-consent"
      title={t.title}
      description={t.lead}
      actions={
        q.data && q.data.purposes.some((p) => p.notices.length > 0) ? (
          <Button variant="secondary" size="sm" onClick={() => setRecording(true)}>
            <FileSignature aria-hidden />
            {t.record}
          </Button>
        ) : undefined
      }
      flush
    >
      {q.isPending ? (
        <div className="px-6 pb-5">
          <SkeletonRows rows={3} label={en.states.loading.title} />
        </div>
      ) : !q.data ? (
        <div className="px-6 pb-5">
          <StatePanel kind="error" title={en.states.error.title} />
        </div>
      ) : (
        <>
          <section aria-labelledby="guardian-checks" className="border-t border-line px-6 py-4">
            <h3
              id="guardian-checks"
              className="flex items-center gap-2 text-body font-semibold text-ink"
            >
              <ShieldCheck aria-hidden className="size-4 text-ink-muted" />
              {t.guardiansTitle}
            </h3>
            <p className="mt-0.5 text-caption text-ink-muted">{t.guardiansLead}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {q.data.guardians.map((g) => (
                <li key={g.personId} className="flex flex-wrap items-center gap-2">
                  <span className="text-body text-ink">{g.name}</span>
                  <Pill tone={g.verified ? 'go' : 'warn'}>
                    {g.verified ? t.verified : t.notVerified}
                  </Pill>
                  {g.verified && (
                    <span className="text-caption text-ink-muted">
                      {t.verifiedHow(
                        g.verified.document
                          ? (t.documents[g.verified.document] ?? g.verified.document)
                          : (t.methods[g.verified.method] ?? g.verified.method),
                        day(g.verified.verifiedAt),
                      )}
                    </span>
                  )}
                  {canVerify && (
                    <Button
                      size="sm"
                      variant={g.verified ? 'quiet' : 'secondary'}
                      aria-label={g.verified ? t.revokeFor(g.name) : t.verifyFor(g.name)}
                      onClick={() =>
                        setChecking({ kind: g.verified ? 'revoke' : 'verify', guardian: g })
                      }
                    >
                      {g.verified ? t.revoke : t.verify}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {q.data.purposes.length === 0 ? (
            <p className="border-t border-line px-6 py-4 text-body text-ink-muted">{t.none}</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {q.data.purposes.map((p) => (
                <li
                  key={p.purpose}
                  className="flex flex-col gap-2 px-6 py-3 sm:flex-row sm:items-start"
                >
                  <span className="text-body font-medium text-ink sm:w-64 sm:shrink-0">
                    {purposeName(p.purpose)}
                  </span>
                  <ul className="flex flex-1 flex-col gap-1.5">
                    {q.data.guardians.map((g) => {
                      const d = p.decisions.find((x) => x.guardianId === g.personId);
                      return (
                        <li key={g.personId} className="flex flex-wrap items-center gap-2">
                          <span className="text-body text-ink">{g.name}</span>
                          <Pill
                            tone={
                              !d
                                ? 'neutral'
                                : d.decision === 'granted' && g.verified
                                  ? 'go'
                                  : 'warn'
                            }
                          >
                            {!d
                              ? t.undecided
                              : d.decision === 'withdrawn'
                                ? t.withdrawn
                                : g.verified
                                  ? t.granted
                                  : t.awaiting}
                          </Pill>
                          {d && (
                            <span className="text-caption text-ink-muted">
                              {t.version(d.noticeVersion)} · {t.sources[d.source] ?? d.source}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {checking && (
        <CheckForm
          studentId={studentId}
          kind={checking.kind}
          guardian={checking.guardian}
          onClose={() => setChecking(null)}
          onDone={(m) => {
            setChecking(null);
            onMessage(m);
          }}
        />
      )}
      {recording && q.data && (
        <RecordForm
          consent={q.data}
          onClose={() => setRecording(false)}
          onDone={() => {
            setRecording(false);
            onMessage(t.saved);
          }}
        />
      )}
    </Section>
  );
}

function RecordForm({
  consent,
  onClose,
  onDone,
}: {
  consent: StudentConsent;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const purposes = consent.purposes.filter((p) => p.notices.length > 0);
  const [purpose, setPurpose] = useState(purposes[0]?.purpose ?? '');
  const [guardianId, setGuardianId] = useState(consent.guardians[0]?.personId ?? '');
  const [decision, setDecision] = useState<'granted' | 'withdrawn'>('granted');
  const notices = purposes.find((p) => p.purpose === purpose)?.notices ?? [];
  const notice = notices.find((n) => n.language === 'en') ?? notices[0];
  const save = useMutation({
    mutationFn: () =>
      api.post(`/consent/students/${consent.studentId}`, {
        noticeId: notice?.id,
        guardianId,
        decision,
        source: 'paper',
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['student-consent', consent.studentId] });
      onDone();
    },
  });
  return (
    <FormModal
      title={t.formTitle}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!notice || !guardianId}
      error={save.error ? (en.students.errors.error ?? '') : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.purpose}>
        <select className={fieldInput} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          {purposes.map((p) => (
            <option key={p.purpose} value={p.purpose}>
              {purposeName(p.purpose)}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.guardian}>
        <select
          className={fieldInput}
          value={guardianId}
          onChange={(e) => setGuardianId(e.target.value)}
        >
          {consent.guardians.map((g) => (
            <option key={g.personId} value={g.personId}>
              {g.name}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.decision} wide>
        <select
          className={fieldInput}
          value={decision}
          onChange={(e) => setDecision(e.target.value as 'granted' | 'withdrawn')}
        >
          <option value="granted">{t.granted}</option>
          <option value="withdrawn">{t.withdrawn}</option>
        </select>
      </ModalField>
      {notice && (
        <p className="max-h-40 overflow-y-auto rounded-lg bg-paper p-3 text-caption whitespace-pre-line text-ink-muted sm:col-span-2">
          {notice.body}
        </p>
      )}
    </FormModal>
  );
}

const DOCUMENTS = ['aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id', 'other'] as const;

/** Verify a guardian as an identifiable adult, or undo a verification made in error. */
function CheckForm({
  studentId,
  kind,
  guardian,
  onClose,
  onDone,
}: {
  studentId: string;
  kind: 'verify' | 'revoke';
  guardian: Guardian;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<'document_seen' | 'known_record'>('document_seen');
  const [document, setDocument] = useState<(typeof DOCUMENTS)[number]>('aadhaar');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () =>
      kind === 'verify'
        ? api.post(`/consent/guardians/${guardian.personId}/verify`, {
            method,
            document: method === 'document_seen' ? document : null,
            note: note.trim() || null,
          })
        : api.post(`/consent/guardians/${guardian.personId}/revoke`, { note }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['student-consent', studentId] });
      onDone(kind === 'verify' ? t.verifiedSaved : t.revokedSaved);
    },
  });
  const verify = kind === 'verify';
  return (
    <FormModal
      title={verify ? t.verifyTitle : t.revokeTitle}
      description={`${guardian.name} · ${verify ? t.verifyLead : t.revokeLead}`}
      submitLabel={verify ? t.verifySave : t.revokeSave}
      cancelLabel={t.cancel}
      tone={verify ? 'primary' : 'danger'}
      pending={save.isPending}
      submitDisabled={!verify && note.trim().length === 0}
      error={save.error ? (en.students.errors.error ?? '') : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {verify && (
        <>
          <ModalField label={t.method}>
            <select
              className={fieldInput}
              value={method}
              onChange={(e) => setMethod(e.target.value as 'document_seen' | 'known_record')}
            >
              <option value="document_seen">{t.methods.document_seen}</option>
              <option value="known_record">{t.methods.known_record}</option>
            </select>
          </ModalField>
          {method === 'document_seen' && (
            <ModalField label={t.document}>
              <select
                className={fieldInput}
                value={document}
                onChange={(e) => setDocument(e.target.value as (typeof DOCUMENTS)[number])}
              >
                {DOCUMENTS.map((d) => (
                  <option key={d} value={d}>
                    {t.documents[d]}
                  </option>
                ))}
              </select>
            </ModalField>
          )}
        </>
      )}
      <ModalField label={verify ? t.note : t.revokeNote} wide>
        <input
          className={fieldInput}
          required={!verify}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}
