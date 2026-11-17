'use client';

import type { AccessOverview } from '@campusverse/platform-access';
import type { Assignment } from '@campusverse/platform-permissions';
import {
  Announcer,
  Avatar,
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, ShieldQuestion } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { RecordStamp } from '../../common/activity';
import { fieldInput } from '../../common/custom-fields';
import { useMe } from '../../common/me';
import { SettingsFrame } from '../frame';
import { CheckAccess } from './check-access';

const t = en.accessAdmin;
type Tree = {
  organisation: { orgId: string; name: string };
  campuses: {
    campusId: string;
    name: string;
    institutions: { institutionId: string; name: string }[];
  }[];
};
type Staff = { personId: string; name: string; designation: string | null; status: string };

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const show = (d: string) => day.format(new Date(`${d}T00:00:00`));
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

export function AccessView() {
  const qc = useQueryClient();
  const { can } = useMe();
  const [giving, setGiving] = useState(false);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const people = useQuery({
    queryKey: ['access-people'],
    queryFn: () =>
      api.get<{ assignments: Assignment[]; names: Record<string, string> }>('/access/people'),
  });
  const tree = useQuery({
    queryKey: ['scope-tree'],
    queryFn: () => api.get<Tree>('/school/setup/tree'),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['access-people'] });
    void qc.invalidateQueries({ queryKey: ['access-roles'] });
    void qc.invalidateQueries({ queryKey: ['stamps'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };

  const scopeName = (a: Pick<Assignment, 'scopeType' | 'scopeId'>) => {
    if (a.scopeType === 'organisation') return t.wholeOrganisation;
    for (const c of tree.data?.campuses ?? []) {
      if (c.campusId === a.scopeId) return c.name;
      const i = c.institutions.find((x) => x.institutionId === a.scopeId);
      if (i) return i.name;
    }
    return '…';
  };

  const frame = (body: React.ReactNode) => (
    <SettingsFrame
      title={t.title}
      lead={t.lead}
      actions={
        <>
          {can('platform.role.read') && (
            <Button variant="secondary" onClick={() => setChecking(true)}>
              <ShieldQuestion aria-hidden className="size-4" />
              {en.rolesAdmin.check}
            </Button>
          )}
          {can('platform.role.assign') && !giving && (
            <Button onClick={() => setGiving(true)}>
              <Plus aria-hidden className="size-4" />
              {t.give}
            </Button>
          )}
        </>
      }
    >
      {body}
      {checking && (
        <CheckAccess
          people={people.data}
          institutions={(tree.data?.campuses ?? []).flatMap((c) => c.institutions)}
          onClose={() => setChecking(false)}
        />
      )}
      <Announcer message={message} />
    </SettingsFrame>
  );

  if (people.isPending) return frame(<SkeletonRows rows={5} label={en.states.loading.title} />);
  if (people.isError || !people.data)
    return frame(
      people.error instanceof ApiFailure && people.error.status === 403 ? (
        <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
      ) : (
        <StatePanel kind="error" title={en.states.error.title} />
      ),
    );
  const { assignments: all, names } = people.data;
  // Parents' access comes from their guardian links, not from staff roles: keep them out of
  // this list, and say how many there are.
  const parentOnly = new Set(
    [...new Set(all.map((a) => a.personId))].filter((id) =>
      all.filter((a) => a.personId === id).every((a) => a.roleKey === 'parent'),
    ),
  );
  const assignments = all.filter((a) => !parentOnly.has(a.personId) && a.roleKey !== 'parent');
  const byPerson = [...new Set(assignments.map((a) => a.personId))]
    .map((id) => ({
      id,
      name: names[id] ?? '…',
      items: assignments.filter((a) => a.personId === id),
    }))
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return frame(
    <>
      {giving && tree.data && (
        <GiveAccess
          tree={tree.data}
          onCancel={() => setGiving(false)}
          onDone={() => {
            setGiving(false);
            setMessage(t.given);
            refresh();
          }}
        />
      )}
      <Section
        title={t.staffTitle}
        description={parentOnly.size ? t.parents(parentOnly.size) : undefined}
        flush
        actions={
          <label className="relative flex items-center">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 size-4 text-ink-muted"
            />
            <input
              aria-label={t.search}
              placeholder={t.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${fieldInput} h-9 w-56 pl-9`}
            />
          </label>
        }
      >
        {byPerson.length === 0 ? (
          <EmptyState compact art="search" title={t.empty} />
        ) : (
          <ul className="divide-y divide-line">
            {byPerson.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
                <span className="flex min-w-0 items-center gap-3 sm:w-64 sm:shrink-0">
                  <Avatar name={p.name} />
                  <span className="truncate text-body font-semibold text-ink">{p.name}</span>
                </span>
                <ul className="flex min-w-0 flex-1 flex-col gap-2">
                  {p.items.map((a) => (
                    <AssignmentRow
                      key={a.id}
                      a={a}
                      where={scopeName(a)}
                      onEnded={() => {
                        setMessage(t.ended);
                        refresh();
                      }}
                    />
                  ))}
                  <li>
                    <RecordStamp id={p.id} />
                  </li>
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>,
  );
}

function AssignmentRow({
  a,
  where,
  onEnded,
}: {
  a: Assignment;
  where: string;
  onEnded: () => void;
}) {
  const { can } = useMe();
  const [ending, setEnding] = useState(false);
  const [last, setLast] = useState(today());
  const end = useMutation({
    mutationFn: () => api.post(`/access/assignments/${a.id}/end`, { lastDay: last }),
    onSuccess: () => {
      setEnding(false);
      onEnded();
    },
  });
  return (
    <li className="flex flex-col gap-2 rounded-xl bg-paper/70 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={a.roleKey === 'owner' ? 'go' : 'neutral'}>{a.roleName}</Pill>
        <span className="text-body text-ink">{where}</span>
        <span className="text-caption text-ink-muted">
          {a.current ? '' : `${t.upcoming} · `}
          {show(a.from)} – {a.until ? show(a.until) : t.noEnd}
        </span>
        {can('platform.role.assign') && (
          <button
            type="button"
            onClick={() => setEnding(true)}
            className="ml-auto rounded-md px-2 py-1 text-caption font-medium text-signal-stop-ink hover:bg-signal-stop-tint"
          >
            {t.end}
          </button>
        )}
      </div>
      {ending && (
        <FormModal
          title={`${t.end}: ${a.roleName}`}
          description={where}
          size="md"
          tone="danger"
          submitLabel={t.end}
          cancelLabel={en.form.cancel}
          pending={end.isPending}
          error={end.isError ? errorText(end.error) : null}
          onClose={() => {
            end.reset();
            setEnding(false);
          }}
          onSubmit={() => end.mutate()}
        >
          <ModalField label={t.endOn}>
            <input
              type="date"
              required
              value={last}
              onChange={(e) => setLast(e.target.value)}
              className={fieldInput}
            />
          </ModalField>
        </FormModal>
      )}
    </li>
  );
}

function GiveAccess({
  tree,
  onCancel,
  onDone,
}: {
  tree: Tree;
  onCancel: () => void;
  onDone: () => void;
}) {
  const school = useInstitution();
  const roles = useQuery({
    queryKey: ['access-roles'],
    queryFn: () => api.get<AccessOverview>('/access/roles'),
  });
  const staff = useQuery({
    queryKey: ['staff', school.institutionId],
    queryFn: () => api.get<Staff[]>(`/people/staff?institutionId=${school.institutionId}`),
    enabled: !!school.institutionId,
  });
  const [f, setF] = useState({
    personId: '',
    roleId: '',
    scope: `institution:${school.institutionId ?? ''}`,
    from: today(),
    until: '',
  });
  const give = useMutation({
    mutationFn: () => {
      const [type, id] = f.scope.split(':') as ['organisation' | 'campus' | 'institution', string];
      return api.post('/access/assignments', {
        personId: f.personId,
        roleId: f.roleId,
        scope: { type, id: type === 'organisation' ? tree.organisation.orgId : id },
        from: f.from,
        until: f.until || null,
      });
    },
    onSuccess: onDone,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FormModal
      title={t.give}
      size="lg"
      submitLabel={t.confirm}
      cancelLabel={en.form.cancel}
      pending={give.isPending}
      error={give.isError ? errorText(give.error) : null}
      onClose={onCancel}
      onSubmit={() => give.mutate()}
    >
      <>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.person}</span>
          <select required value={f.personId} onChange={set('personId')} className={fieldInput}>
            <option value="">{t.choosePerson}</option>
            {(staff.data ?? [])
              .filter((s) => s.status !== 'left')
              .map((s) => (
                <option key={s.personId} value={s.personId}>
                  {s.name}
                  {s.designation ? ` · ${s.designation}` : ''}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.role}</span>
          <select required value={f.roleId} onChange={set('roleId')} className={fieldInput}>
            <option value="" />
            {(roles.data?.roles ?? [])
              .filter((r) => r.key !== 'parent')
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.where}</span>
          <select required value={f.scope} onChange={set('scope')} className={fieldInput}>
            <option value={`organisation:${tree.organisation.orgId}`}>{t.wholeOrganisation}</option>
            {tree.campuses.map((c) => (
              <optgroup key={c.campusId} label={c.name}>
                <option value={`campus:${c.campusId}`}>{c.name}</option>
                {c.institutions.map((i) => (
                  <option key={i.institutionId} value={`institution:${i.institutionId}`}>
                    {i.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.from}</span>
          <input
            type="date"
            required
            value={f.from}
            onChange={set('from')}
            className={fieldInput}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.until}</span>
          <input
            type="date"
            value={f.until}
            min={f.from}
            onChange={set('until')}
            className={fieldInput}
          />
          <span className="text-caption text-ink-muted">{t.untilHint}</span>
        </label>
      </>
    </FormModal>
  );
}
