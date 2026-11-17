'use client';

// Identity & Access › Check access (rule book §10.3): why a person can or can't use a permission
// at a place — the roles that carry it and whether they reach there, the relationship it needs,
// its data class, and any case grant. The answer comes from the same check every screen and
// Verse AI use.
import type { AccessExplanation } from '@campusverse/platform-access';
import { FormModal, ModalField, Pill } from '@campusverse/ui';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { fieldInput } from '../../common/custom-fields';

const t = en.rolesAdmin;
const r = t.checkResult;

export function CheckAccess({
  people,
  institutions,
  onClose,
}: {
  people: { assignments: { personId: string }[]; names: Record<string, string> } | undefined;
  institutions: { institutionId: string; name: string }[];
  onClose: () => void;
}) {
  const persons = people
    ? [...new Set(people.assignments.map((a) => a.personId))]
        .map((id) => ({ id, name: people.names[id] ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const permissions = Object.entries(en.permissionNames as Record<string, string>).sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const [personId, setPersonId] = useState(persons[0]?.id ?? '');
  const [permission, setPermission] = useState(permissions[0]?.[0] ?? '');
  const [institutionId, setInstitutionId] = useState(institutions[0]?.institutionId ?? '');
  const check = useMutation({
    mutationFn: () =>
      api.post<AccessExplanation>('/access/explain', {
        personId,
        permission,
        institutionId: institutionId || null,
      }),
  });
  const x = check.data;
  return (
    <FormModal
      title={t.check}
      description={t.checkLead}
      submitLabel={t.checkForm.run}
      cancelLabel={en.form.close}
      pending={check.isPending}
      submitDisabled={!personId || !permission}
      error={check.isError ? (t.errors.error ?? '') : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => check.mutate()}
    >
      <ModalField label={t.checkForm.person}>
        <select
          value={personId}
          onChange={(e) => (setPersonId(e.target.value), check.reset())}
          className={fieldInput}
        >
          {persons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.checkForm.institution}>
        <select
          value={institutionId}
          onChange={(e) => (setInstitutionId(e.target.value), check.reset())}
          className={fieldInput}
        >
          <option value="">{t.checkForm.anywhere}</option>
          {institutions.map((i) => (
            <option key={i.institutionId} value={i.institutionId}>
              {i.name}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.checkForm.permission} wide>
        <select
          value={permission}
          onChange={(e) => (setPermission(e.target.value), check.reset())}
          className={fieldInput}
        >
          {permissions.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </ModalField>
      {x && (
        <section
          aria-live="polite"
          aria-label={x.decision.allowed ? r.allowed : r.denied}
          className="flex flex-col gap-3 rounded-lg border border-line bg-paper/60 p-4 sm:col-span-2"
        >
          <p className="flex items-center gap-2 font-semibold text-ink">
            {x.decision.allowed ? (
              <CheckCircle2 aria-hidden className="size-5 text-signal-go" />
            ) : (
              <XCircle aria-hidden className="size-5 text-signal-stop" />
            )}
            {x.decision.allowed ? r.allowed : r.denied}
            <Pill tone={x.dataClass === 'sensitive' ? 'stop' : 'neutral'}>
              {r.dataClass(t.classes[x.dataClass] ?? x.dataClass)}
            </Pill>
          </p>
          {x.decision.allowed && x.decision.case && (
            <p className="text-body text-ink">{r.viaCase}</p>
          )}
          {!x.decision.allowed && (
            <p className="text-body text-ink">
              {r.reasons[x.decision.reason] ?? x.decision.reason}
            </p>
          )}
          <div>
            <h3 className="mb-1 text-caption font-semibold tracking-wide text-ink-muted uppercase">
              {r.roles}
            </h3>
            {x.roles.length === 0 ? (
              <p className="text-caption text-ink-muted">{r.noRoles}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {x.roles.map((role, i) => (
                  <li
                    key={`${role.role}-${i}`}
                    className="flex flex-wrap items-center gap-2 text-body text-ink"
                  >
                    {role.role}
                    <span className="text-caption text-ink-muted">
                      {r.scopes[role.scope] ?? role.scope}
                    </span>
                    <Pill tone={role.reaches ? 'go' : 'warn'}>
                      {role.reaches ? r.reaches : r.notHere}
                    </Pill>
                    {role.needsRelationship && <Pill>{r.relationship}</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </FormModal>
  );
}
