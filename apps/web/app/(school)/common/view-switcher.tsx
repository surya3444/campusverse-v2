'use client';

// The sidebar's view switcher (owner's brief, 20 Nov 2026): which organisation, what part of it
// the person looks at (whole organisation, some campuses, some institutions), and the institution
// screens that work on one at a time use. The API keeps the view inside the person's roles.
import { FormModal, Pill, Segmented, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  ChevronsUpDown,
  Layers,
  MapPin,
  Plus,
  School,
  SlidersHorizontal,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { ApiFailure, api, session } from '../../../lib/api';
import { chooseInstitution } from '../../../lib/scope';
import { useView, type MyView, type ViewLevel } from '../../../lib/view';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { useMe } from './me';

const t = en.view;
type Profile = { orgId: string; personId: string; orgName: string; personName: string };

const item =
  'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-body text-ink outline-none data-[highlighted]:bg-navy-50';
const label = 'px-3 pt-2 pb-1 text-caption font-medium text-ink-muted';

/** What the view covers, in words: "Whole organisation", "North Campus", "3 institutions". */
function describe(v: MyView): string {
  if (v.level === 'organisation') return t.whole;
  const names =
    v.level === 'campus'
      ? v.campuses.filter((c) => v.ids.includes(c.campusId)).map((c) => c.name)
      : v.campuses
          .flatMap((c) => c.institutions)
          .filter((i) => v.ids.includes(i.institutionId))
          .map((i) => i.name);
  return names.length === 1 ? (names[0] ?? '') : t.count(v.level, names.length);
}

export function ViewSwitcher() {
  const view = useView();
  const chosen = useInstitution();
  const { can } = useMe();
  const profiles = useQuery({
    queryKey: ['profiles'],
    queryFn: () => api.get<Profile[]>('/auth/profiles'),
    staleTime: 300_000,
  });
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const v = view.data;
  if (!v) return <span className="skeleton block h-14 w-full rounded-xl bg-white/5" />;
  const orgs = (profiles.data ?? []).filter(
    (p, i, all) => all.findIndex((x) => x.orgId === p.orgId) === i,
  );
  const switchTo = async (p: Profile) => {
    try {
      await session.post('profile', { orgId: p.orgId, personId: p.personId });
      window.location.assign('/');
    } catch {
      setFailed(true);
    }
  };
  const another = async () => {
    try {
      await session.post('onboarding/another', {});
      window.location.assign('/onboarding?another=1');
    } catch {
      setFailed(true);
    }
  };

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="flex w-full min-w-0 items-center gap-3 rounded-xl bg-white/5 p-2.5 text-left transition-colors hover:bg-white/10">
          {/* The visible text stays the start of the accessible name (WCAG 2.5.3). */}
          <span className="sr-only">{en.app.scope}:</span>
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#0b4ea2,#1a6fd0)] text-cyan-200"
          >
            <Building2 className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body font-medium text-white">
              {chosen.institutionName ?? v.organisation.name}
            </span>
            <span className="truncate text-caption text-white/65">
              {v.organisation.name} · {describe(v)}
            </span>
          </span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-white/60" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 max-h-[80dvh] w-80 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-overlay)]"
          >
            {orgs.length > 1 && (
              <>
                <DropdownMenu.Label className={label}>{t.organisation}</DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  value={v.organisation.orgId}
                  onValueChange={(id) => {
                    const p = orgs.find((o) => o.orgId === id);
                    if (p && id !== v.organisation.orgId) void switchTo(p);
                  }}
                >
                  {orgs.map((o) => (
                    <DropdownMenu.RadioItem key={o.orgId} value={o.orgId} className={item}>
                      <Layers aria-hidden className="size-4 shrink-0 text-ink-muted" />
                      <span className="min-w-0 flex-1 truncate">{o.orgName}</span>
                      <DropdownMenu.ItemIndicator>
                        <Check aria-hidden className="size-4 text-navy-950" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </>
            )}
            {can('platform.organisation.manage') && (
              <DropdownMenu.Item onSelect={() => void another()} className={item}>
                <Plus aria-hidden className="size-4 shrink-0 text-ink-muted" />
                {t.newOrganisation}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item onSelect={() => setEditing(true)} className={item}>
              <SlidersHorizontal aria-hidden className="size-4 shrink-0 text-ink-muted" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{t.change}</span>
                <span className="truncate text-caption text-ink-muted">{describe(v)}</span>
              </span>
            </DropdownMenu.Item>
            {chosen.inView.length > 0 && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-line" />
                <DropdownMenu.Label className={label}>{t.workingIn}</DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  value={chosen.institutionId ?? ''}
                  onValueChange={chooseInstitution}
                >
                  {chosen.inView.map((i) => (
                    <DropdownMenu.RadioItem key={i.id} value={i.id} className={item}>
                      <School aria-hidden className="size-4 shrink-0 text-ink-muted" />
                      <span className="min-w-0 flex-1 truncate">{i.name}</span>
                      <DropdownMenu.ItemIndicator>
                        <Check aria-hidden className="size-4 text-navy-950" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {failed && (
        <p role="alert" className="mt-2 text-caption text-[#ff9b9b]">
          {t.failed}
        </p>
      )}
      {editing && <ViewDialog view={v} onClose={() => setEditing(false)} />}
    </>
  );
}

const LEVEL_ICON = { organisation: Layers, campus: MapPin, institution: School } as const;

/** Choose the view: the whole organisation, some campuses or some institutions (within reach). */
function ViewDialog({ view, onClose }: { view: MyView; onClose: () => void }) {
  const qc = useQueryClient();
  const levels = (['organisation', 'campus', 'institution'] as const).filter(
    (l) =>
      (['organisation', 'campus', 'institution'] as const).indexOf(l) >=
      (['organisation', 'campus', 'institution'] as const).indexOf(view.reach),
  );
  const [level, setLevel] = useState<ViewLevel>(view.level);
  const [picked, setPicked] = useState<Record<ViewLevel, string[]>>({
    organisation: [],
    campus: view.level === 'campus' ? view.ids : [],
    institution: view.level === 'institution' ? view.ids : [],
  });
  const ids = picked[level];
  const toggle = (id: string) =>
    setPicked({
      ...picked,
      [level]: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    });
  const save = useMutation({
    mutationFn: () => api.post<MyView>('/organisation/view', { level, ids }),
    onSuccess: (v) => {
      qc.setQueryData(['view'], v);
      // Screens that work on one institution move to the first one in the new view.
      const first = v.institutionIds[0];
      if (first) chooseInstitution(first);
      onClose();
    },
  });
  const options =
    level === 'campus'
      ? view.campuses.map((c) => ({
          id: c.campusId,
          name: c.name,
          note: [c.city, t.institutions(c.institutions.length)].filter(Boolean).join(' · '),
          disabled: c.institutions.length === 0,
          kinds: [...new Set(c.institutions.map((i) => i.type))],
        }))
      : view.campuses.flatMap((c) =>
          c.institutions.map((i) => ({
            id: i.institutionId,
            name: i.name,
            note: c.name,
            disabled: false,
            kinds: [i.type],
          })),
        );
  const all = options.filter((o) => !o.disabled).map((o) => o.id);
  return (
    <FormModal
      title={t.title}
      description={t.lead}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={level !== 'organisation' && ids.length === 0}
      error={
        save.error
          ? (t.errors[save.error instanceof ApiFailure ? save.error.code : 'error'] ??
            t.errors.error)
          : null
      }
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <div className="flex flex-col gap-4">
        <Segmented
          label={t.level}
          value={level}
          onChange={setLevel}
          options={levels.map((l) => ({ value: l, label: t.levels[l] }))}
        />
        {level === 'organisation' ? (
          <p className="rounded-lg bg-paper px-4 py-3 text-body text-ink-muted">
            {t.wholeNote(
              view.organisation.name,
              view.campuses.length,
              view.campuses.reduce((n, c) => n + c.institutions.length, 0),
            )}
          </p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 flex w-full items-center justify-between text-body font-medium text-ink">
              <span>{t.pick[level]}</span>
            </legend>
            <div className="flex gap-3 text-caption">
              <button
                type="button"
                className="font-medium text-navy-950 hover:underline"
                onClick={() => setPicked({ ...picked, [level]: all })}
              >
                {t.all}
              </button>
              <button
                type="button"
                className="font-medium text-navy-950 hover:underline"
                onClick={() => setPicked({ ...picked, [level]: [] })}
              >
                {t.none}
              </button>
            </div>
            <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
              {options.map((o) => {
                const Icon = LEVEL_ICON[level];
                const on = ids.includes(o.id);
                return (
                  <li key={o.id}>
                    <label
                      className={cx(
                        'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy-950',
                        on ? 'border-navy-950 bg-navy-50' : 'border-line hover:border-line-strong',
                        o.disabled && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={o.disabled}
                        onChange={() => toggle(o.id)}
                        className="size-4 accent-[#04266d]"
                      />
                      <Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-body font-medium text-ink">{o.name}</span>
                        <span className="truncate text-caption text-ink-muted">{o.note}</span>
                      </span>
                      <span className="flex gap-1">
                        {o.kinds.map((k) => (
                          <Pill key={k}>{t.kinds[k] ?? k}</Pill>
                        ))}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}
      </div>
    </FormModal>
  );
}
