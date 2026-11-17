'use client';

import type { AccessOverview } from '@campusverse/platform-access';
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
import { Lock, Plus, ShieldAlert, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { RecordStamp, ago } from '../../common/activity';
import { fieldInput } from '../../common/custom-fields';
import { useMe } from '../../common/me';
import { SettingsFrame } from '../frame';

const t = en.rolesAdmin;
type View = AccessOverview & {
  me: string;
  areas: string[];
  catalogue: Record<string, { area: string; sensitive: boolean }>;
  /** Rule book §10.3: public, internal, personal, financial or sensitive. */
  classes: Record<string, string>;
  names: Record<string, string>;
};
type Plan = { add: string[]; request: string[]; remove: string[] };

const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

export function RolesView() {
  const qc = useQueryClient();
  const { can } = useMe();
  const view = useQuery({
    queryKey: ['access-roles'],
    queryFn: () => api.get<View>('/access/roles'),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['access-roles'] });
    void qc.invalidateQueries({ queryKey: ['stamps'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };
  const role = view.data?.roles.find((r) => r.id === (selected ?? view.data?.roles[0]?.id));

  if (view.isPending)
    return (
      <SettingsFrame title={t.title} lead={t.lead}>
        <SkeletonRows rows={5} label={en.states.loading.title} />
      </SettingsFrame>
    );
  if (view.isError || !view.data)
    return (
      <SettingsFrame title={t.title} lead={t.lead}>
        {view.error instanceof ApiFailure && view.error.status === 403 ? (
          <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
        ) : (
          <StatePanel kind="error" title={en.states.error.title} />
        )}
      </SettingsFrame>
    );
  const v = view.data;
  const manage = can('platform.role.manage');

  return (
    <SettingsFrame
      title={t.title}
      lead={t.lead}
      actions={
        manage && !creating ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            {t.newRole}
          </Button>
        ) : undefined
      }
    >
      <Requests view={v} onDone={(m) => (setMessage(m), refresh())} />

      {creating && (
        <CreateRole
          roles={v.roles}
          onCancel={() => setCreating(false)}
          onDone={(id, plan) => {
            setCreating(false);
            setSelected(id);
            setMessage(t.result(plan.add.length, plan.request.length, plan.remove.length));
            refresh();
          }}
        />
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav aria-label={t.title} className="panel p-2 lg:sticky lg:top-24">
          <ul className="flex flex-col gap-1">
            {v.roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-current={r.id === role?.id ? 'true' : undefined}
                  onClick={() => setSelected(r.id)}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                    r.id === role?.id ? 'bg-navy-50' : 'hover:bg-paper',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={cx(
                        'truncate text-body',
                        r.id === role?.id ? 'font-semibold text-navy-950' : 'font-medium text-ink',
                      )}
                    >
                      {r.name}
                    </span>
                    <span className="flex items-center gap-1 text-caption text-ink-muted">
                      <Users aria-hidden className="size-3" />
                      {t.holders(r.holders)}
                    </span>
                  </span>
                  {r.locked && <Lock aria-label={t.locked} className="size-3.5 text-ink-muted" />}
                  {r.pending.length > 0 && <Pill tone="warn">{r.pending.length}</Pill>}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {role && (
          <RoleEditor
            key={role.id}
            role={role}
            view={v}
            manage={manage}
            onDone={(plan) => {
              setMessage(t.result(plan.add.length, plan.request.length, plan.remove.length));
              refresh();
            }}
          />
        )}
      </div>
      <Announcer message={message} />
    </SettingsFrame>
  );
}

function CreateRole({
  roles,
  onCancel,
  onDone,
}: {
  roles: View['roles'];
  onCancel: () => void;
  onDone: (id: string, plan: Plan) => void;
}) {
  const [name, setName] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post<{ roleId: string; plan: Plan }>('/access/roles', {
        name,
        copyFrom: copyFrom || null,
      }),
    onSuccess: (r) => onDone(r.roleId, r.plan),
  });
  return (
    <FormModal
      title={t.newRole}
      submitLabel={t.create}
      cancelLabel={en.form.cancel}
      pending={create.isPending}
      error={create.isError ? errorText(create.error) : null}
      onClose={onCancel}
      onSubmit={() => create.mutate()}
    >
      <>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.name}</span>
          <input
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldInput}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.copyFrom}</span>
          <select
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
            className={fieldInput}
          >
            <option value="">{t.blank}</option>
            {roles
              .filter((r) => r.key !== 'parent' && r.key !== 'owner')
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
      </>
    </FormModal>
  );
}

function RoleEditor({
  role,
  view,
  manage,
  onDone,
}: {
  role: View['roles'][number];
  view: View;
  manage: boolean;
  onDone: (plan: Plan) => void;
}) {
  const [chosen, setChosen] = useState(() => new Set([...role.permissions, ...role.pending]));
  const [name, setName] = useState(role.name);
  // Reset only when what is saved changes, never on a background refetch of the same role.
  const saved = [...role.permissions, '|', ...role.pending].join(',');
  useEffect(() => setChosen(new Set(saved.split(',').filter((p) => p && p !== '|'))), [saved]);
  const editable = manage && !role.locked;
  const original = useMemo(() => new Set(saved.split(',').filter((p) => p && p !== '|')), [saved]);
  const diff =
    [...chosen].filter((p) => !original.has(p)).length +
    [...original].filter((p) => !chosen.has(p)).length;
  const save = useMutation({
    mutationFn: async () => {
      if (name.trim() !== role.name) await api.post(`/access/roles/${role.id}/name`, { name });
      return api.post<Plan>(`/access/roles/${role.id}/permissions`, { permissions: [...chosen] });
    },
    onSuccess: onDone,
  });
  const byArea = view.areas.map((a) => ({
    area: a,
    permissions: Object.entries(view.catalogue)
      .filter(([, e]) => e.area === a)
      .map(([p]) => p),
  }));

  return (
    <Section
      title={role.name}
      description={
        role.key === 'owner'
          ? t.lockedOwner
          : role.key === 'parent'
            ? t.lockedParent
            : t.holders(role.holders)
      }
      footer={
        editable ? (
          <>
            <span role="status" className="flex-1">
              {save.isError ? (
                <span className="text-signal-stop-ink">{errorText(save.error)}</span>
              ) : diff > 0 || name.trim() !== role.name ? (
                t.unsaved(diff || 1)
              ) : (
                ''
              )}
            </span>
            <Button
              disabled={save.isPending || (diff === 0 && name.trim() === role.name)}
              onClick={() => save.mutate()}
            >
              {t.save}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        {editable && (
          <label className="flex max-w-sm flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.name}</span>
            <input
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldInput}
            />
          </label>
        )}
        {role.key === 'parent' ? null : (
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
            {byArea.map(({ area, permissions }) => (
              <fieldset key={area} className="flex flex-col gap-1">
                <legend className="mb-2 text-caption font-semibold tracking-wide text-ink-muted uppercase">
                  {en.areas[area]}
                </legend>
                {permissions.map((p) => {
                  const pending = role.pending.includes(p);
                  const sensitive = view.catalogue[p]?.sensitive;
                  const cls = view.classes[p] ?? 'internal';
                  return (
                    <label
                      key={p}
                      className={cx(
                        'flex items-start gap-3 rounded-lg px-2 py-2 transition-colors',
                        editable && 'cursor-pointer hover:bg-paper',
                      )}
                    >
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={chosen.has(p)}
                        onChange={(e) =>
                          setChosen((c) => {
                            const n = new Set(c);
                            if (e.target.checked) n.add(p);
                            else n.delete(p);
                            return n;
                          })
                        }
                        className="mt-0.5 size-4 shrink-0 accent-navy-950"
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="text-body text-ink">{en.permissionNames[p] ?? p}</span>
                        {(sensitive || pending || (cls !== 'internal' && cls !== 'public')) && (
                          <span className="flex flex-wrap items-center gap-1.5">
                            {cls !== 'internal' && cls !== 'public' && (
                              <Pill tone={cls === 'sensitive' ? 'stop' : 'neutral'}>
                                {t.classes[cls] ?? cls}
                              </Pill>
                            )}
                            {pending ? (
                              <Pill tone="warn">{t.waiting}</Pill>
                            ) : !sensitive ? null : (
                              <span className="inline-flex items-center gap-1 text-caption text-signal-warn-ink">
                                <ShieldAlert aria-hidden className="size-3.5" />
                                {t.sensitive}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        )}
        <RecordStamp id={role.id} className="border-t border-line pt-4" />
      </div>
    </Section>
  );
}

function Requests({ view, onDone }: { view: View; onDone: (m: string) => void }) {
  const { can } = useMe();
  const open = view.requests.filter((r) => r.decision === null);
  const decided = view.requests.filter((r) => r.decision !== null).slice(0, 20);
  const alone = view.owners.length <= 1;
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const decide = useMutation({
    mutationFn: (x: { id: string; decision: string; reason?: string }) =>
      api.post(`/access/requests/${x.id}`, { decision: x.decision, reason: x.reason ?? null }),
    onSuccess: (_, x) => {
      setRejecting(null);
      setConfirming(null);
      setReason('');
      setTyped('');
      onDone(t.decisions[x.decision] ?? '');
    },
  });
  if (open.length === 0 && decided.length === 0) return null;
  const who = (id: string | null) =>
    id ? (view.names[id] ?? en.activity.someone) : en.activity.someone;

  return (
    <Section title={t.requests} description={open.length === 0 ? t.requestsEmpty : undefined} flush>
      {open.length > 0 && (
        <ul className="divide-y divide-line">
          {open.map((r) => {
            const mine = r.requestedBy === view.me;
            return (
              <li key={r.id} className="flex flex-col gap-3 px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal-warn-tint text-signal-warn-ink">
                    <ShieldAlert aria-hidden className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body text-ink">
                      <span className="font-semibold">{r.roleName}</span>:{' '}
                      {en.permissionNames[r.permission] ?? r.permission}
                    </span>
                    <span className="text-caption text-ink-muted">
                      {t.requested(who(r.requestedBy), ago(r.requestedAt))}
                    </span>
                  </span>
                  {can('platform.role.approve') && !mine && (
                    <span className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => setRejecting(r.id)}
                        aria-haspopup="dialog"
                      >
                        {t.reject}
                      </Button>
                      <Button
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: r.id, decision: 'approved' })}
                      >
                        {t.approve}
                      </Button>
                    </span>
                  )}
                  {mine && alone && can('platform.role.approve') && (
                    <Button
                      variant="secondary"
                      onClick={() => setConfirming(r.id)}
                      aria-haspopup="dialog"
                    >
                      {t.confirmAlone}
                    </Button>
                  )}
                  {mine && !alone && <span className="text-caption text-ink-muted">{t.yours}</span>}
                </div>
                {rejecting === r.id && (
                  <FormModal
                    title={`${t.reject}: ${r.roleName}`}
                    description={en.permissionNames[r.permission] ?? r.permission}
                    size="md"
                    tone="danger"
                    submitLabel={t.reject}
                    cancelLabel={en.form.cancel}
                    pending={decide.isPending}
                    error={decide.isError ? errorText(decide.error) : null}
                    onClose={() => {
                      decide.reset();
                      setRejecting(null);
                    }}
                    onSubmit={() => decide.mutate({ id: r.id, decision: 'rejected', reason })}
                  >
                    <ModalField label={t.rejectReason} wide>
                      <input
                        required
                        maxLength={300}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className={fieldInput}
                      />
                    </ModalField>
                  </FormModal>
                )}
                {confirming === r.id && (
                  <FormModal
                    title={t.confirmAlone}
                    description={t.confirmAloneHint}
                    size="md"
                    submitLabel={t.confirmAlone}
                    cancelLabel={en.form.cancel}
                    pending={decide.isPending}
                    submitDisabled={typed !== 'CONFIRM'}
                    error={decide.isError ? errorText(decide.error) : null}
                    onClose={() => {
                      decide.reset();
                      setConfirming(null);
                    }}
                    onSubmit={() => decide.mutate({ id: r.id, decision: 'confirmed_alone' })}
                  >
                    <ModalField label={t.confirmAloneType} wide>
                      <input
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        className={fieldInput}
                        autoComplete="off"
                      />
                    </ModalField>
                  </FormModal>
                )}
                {decide.isError &&
                  decide.variables?.id === r.id &&
                  rejecting !== r.id &&
                  confirming !== r.id && (
                    <p role="alert" className="pl-12 text-caption text-signal-stop-ink">
                      {errorText(decide.error)}
                    </p>
                  )}
              </li>
            );
          })}
        </ul>
      )}
      {decided.length > 0 && (
        <details className="border-t border-line">
          <summary className="cursor-pointer px-5 py-3 text-body font-medium text-ink-muted">
            {t.history} ({decided.length})
          </summary>
          <ul className="divide-y divide-line">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-body">
                <span className="min-w-0 flex-1 text-ink">
                  <span className="font-medium">{r.roleName}</span>:{' '}
                  {en.permissionNames[r.permission] ?? r.permission}
                </span>
                <Pill
                  tone={
                    r.decision === 'rejected'
                      ? 'stop'
                      : r.decision === 'withdrawn'
                        ? 'neutral'
                        : 'go'
                  }
                >
                  {t.decisions[r.decision ?? ''] ?? r.decision}
                </Pill>
                <span className="text-caption text-ink-muted">
                  {t.decidedBy(who(r.decidedBy))} · {r.decidedAt ? ago(r.decidedAt) : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
