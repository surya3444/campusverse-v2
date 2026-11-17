'use client';

import {
  Announcer,
  CommandPalette,
  CommandTrigger,
  PreviewCanvas,
  RecordDrawer,
  ScopeChip,
  cx,
  type CommandItem,
  type ScopeOption,
} from '@campusverse/ui';
import iconColor from '@campusverse/ui/brand/icon-color.svg';
import logoWhite from '@campusverse/ui/brand/logo-white.svg';
import {
  Plus,
  CalendarCheck,
  ChevronDown,
  IndianRupee,
  Inbox,
  Layers,
  LayoutGrid,
  Sparkles,
  LayoutDashboard,
  Megaphone,
  Menu,
  Palette,
  Settings,
  LogOut,
  UserPlus,
  FileBadge,
  BookCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, session } from '../../lib/api';
import { pending } from '../../lib/sync-queue';
import { Dialog, DropdownMenu } from 'radix-ui';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { en } from '../../messages/en';
import { VerseChat } from './common/verse-chat';
import { VerseAnswerView, type AskState } from './verse-answer';
import { chooseInstitution } from '../../lib/scope';
import { SYSTEMS, profileOf, type Profile } from '../../lib/systems';
import { useInstitution } from './attendance/shared';
import { useMe } from './common/me';
import { absentTeacher, defaultScope, scopes, students, unmarkedSections } from './synthetic';

type Actions = {
  openRemind: () => void;
  openStudent: (id: string) => void;
  announce: (m: string) => void;
  openPalette: () => void;
};
const ActionsContext = createContext<Actions | null>(null);

export function useSchoolActions(): Actions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useSchoolActions must be used inside the school shell');
  return ctx;
}

type NavModule = { key: string; label: string; Icon: LucideIcon; items: NavItem[] };
type NavSection = { group: string | null; key: string; modules: NavModule[] };

/**
 * The sidebar, as the hub draws it: Home (Verse AI, Today, My Work, All institutions, All apps),
 * then the rule book's nine systems and Campus Core as sections. Each live module of a system is a
 * row: one page opens directly; several fold under the module's name. Links someone can't use
 * (their `perm`) are left out. A system with nothing live yet appears on /apps only.
 */
const navFor = (profile: Profile, can: (p: string) => boolean): NavSection[] =>
  [
    {
      group: null,
      key: 'home',
      modules: [
        { href: '/ask', label: en.verse.title, Icon: Sparkles },
        { href: '/', label: en.nav.today, Icon: LayoutDashboard },
        { href: '/my-work', label: en.nav.myWork, Icon: Inbox },
        { href: '/organisation', label: en.nav.allInstitutions, Icon: Layers },
        { href: '/apps', label: en.nav.apps, Icon: LayoutGrid },
      ].map((i) => ({ key: i.href, label: i.label, Icon: i.Icon, items: [i] })),
    },
    ...SYSTEMS.filter((s) => s.key !== 'ai').map((s) => ({
      group: en.systems.groups[s.key] ?? s.key,
      key: s.key,
      modules: [
        ...s.apps
          .filter((a) => a.status !== 'planned')
          .map((a) => ({
            key: a.key,
            label: (en.systems.apps as Record<string, readonly string[]>)[a.key]?.[0] ?? a.key,
            Icon: a.Icon,
            items: (a.nav ?? [])
              .filter((n) => (n.for ?? a.for ?? [profile]).includes(profile))
              .filter((n) => !n.perm || n.perm.some(can))
              .map((n) => ({
                href: n.href,
                label: en.nav[n.key as keyof typeof en.nav] as string,
                Icon: n.Icon ?? a.Icon,
              })),
          })),
        ...(s.key === 'core'
          ? [
              {
                key: 'settings',
                label: en.nav.settings,
                Icon: Settings,
                items: [{ href: '/settings', label: en.nav.settings, Icon: Settings }],
              },
            ]
          : []),
      ].filter((m) => m.items.length > 0),
    })),
  ].filter((g) => g.modules.length > 0);
const DEV_NAV = [{ href: '/design', label: en.nav.design, Icon: Palette }];

const NEW_ITEMS: { key: string; href: string; Icon: LucideIcon }[] = [
  { key: 'attendance', href: '/attendance', Icon: CalendarCheck },
  { key: 'fee', href: '/fees', Icon: IndianRupee },
  { key: 'notice', href: '/notices/new', Icon: Megaphone },
  { key: 'enquiry', href: '/admissions?new=1', Icon: UserPlus },
  { key: 'certificate', href: '/certificates?new=1', Icon: FileBadge },
  { key: 'exam', href: '/exams?new=1', Icon: BookCheck },
];

/** The most common jobs, one click from anywhere. */
function NewMenu() {
  const router = useRouter();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={en.nav.newMenu}
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-navy-950 px-4 text-body font-medium text-white shadow-[var(--shadow-button)] transition-all hover:bg-navy-950/90"
      >
        <Plus aria-hidden className="size-4" />
        <span className="hidden sm:inline">{en.nav.new}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border border-line bg-surface p-1.5 shadow-[var(--shadow-overlay)]"
        >
          <DropdownMenu.Label className="px-2.5 py-1.5 text-caption font-medium text-ink-muted">
            {en.nav.newMenu}
          </DropdownMenu.Label>
          {NEW_ITEMS.map(({ key, href, Icon }) => (
            <DropdownMenu.Item
              key={key}
              onSelect={() => router.push(href)}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-body text-ink outline-none data-[highlighted]:bg-navy-50 data-[highlighted]:text-navy-950"
            >
              <Icon aria-hidden className="size-4 text-ink-muted" />
              {en.nav.newItems[key]}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

type NavItem = { href: string; label: string; Icon: LucideIcon };

/** The reference's top-bar profile: a navy initial tile, name and role; a menu with settings and sign out. */
function ProfileMenu() {
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/people/me') });
  if (!me.data) return <span className="skeleton h-10 w-40 rounded-xl" />;
  const { name, roles, photoFileId } = me.data;
  const signOut = async () => {
    const unsent = await pending().catch(() => []);
    if (unsent.length > 0) return;
    await session.post('logout', {}).catch(() => undefined);
    router.replace('/login');
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-2 rounded-xl p-1.5 pr-3 transition-colors hover:bg-navy-50">
        <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[linear-gradient(135deg,#04266d,#1a5fb4)] text-body font-semibold text-white">
          {name.trim().charAt(0).toUpperCase()}
          {photoFileId && (
            <img
              src={`/api/v1/people/me/photo?v=${photoFileId}`}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          )}
        </span>
        <span className="hidden text-left md:block">
          <span className="block max-w-[150px] truncate text-body leading-tight font-medium text-ink">
            {name}
          </span>
          <span className="block max-w-[150px] truncate text-caption text-ink-muted uppercase">
            {roles[0] ?? ''}
          </span>
        </span>
        <ChevronDown aria-hidden className="hidden size-4 text-ink-muted md:block" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-[var(--shadow-overlay)]"
        >
          <div className="border-b border-line px-3 py-3">
            <p className="truncate font-semibold text-ink">{name}</p>
            <p className="truncate text-caption text-ink-muted">{roles.join(', ')}</p>
          </div>
          <DropdownMenu.Item
            onSelect={() => router.push('/settings/profile')}
            className="mt-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-body text-ink outline-none data-[highlighted]:bg-navy-50"
          >
            <Settings aria-hidden className="size-4 text-ink-muted" />
            {en.nav.settings}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => void signOut()}
            className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-body text-signal-stop-ink outline-none data-[highlighted]:bg-signal-stop-tint"
          >
            <LogOut aria-hidden className="size-4" />
            {en.user.signOut}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Whether a link is the page you're on; a `?tab=` link also needs its tab (or, with none, to be first). */
function useIsHere() {
  const path = usePathname();
  const tab = useSearchParams().get('tab');
  return (href: string, first = false) => {
    const [base, query] = href.split('?');
    const onPath = base === '/' ? path === '/' : path === base || path.startsWith(`${base ?? ''}/`);
    if (!onPath || !query) return onPath;
    const want = new URLSearchParams(query).get('tab');
    return tab ? tab === want : first;
  };
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const isHere = useIsHere();
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map(({ href, label, Icon }) => {
        const current = isHere(href);
        return (
          <li key={href}>
            <Link
              href={href}
              {...(onNavigate ? { onClick: onNavigate } : {})}
              aria-current={current ? 'page' : undefined}
              className={cx(
                // The reference: 44 px rows, rounded-xl, a cyan pill with a glow for the page you're on.
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-body font-medium transition-all duration-200',
                current
                  ? 'bg-cyan-400 text-midnight-950 shadow-[0_4px_12px_rgba(10,197,255,0.25)]'
                  : 'text-white/95 hover:bg-white/10',
              )}
            >
              <Icon
                aria-hidden
                className={cx(
                  'size-5 shrink-0 transition-transform duration-200 group-hover:scale-110',
                  current ? 'text-midnight-950' : 'text-white/60',
                )}
              />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A module with several pages, as the hub draws it: the module's row opens a bordered list of its
 * pages; the page you're on has the cyan pill and a bar on the border. Open while you're in it.
 */
function NavModuleRow({ module, onNavigate }: { module: NavModule; onNavigate?: () => void }) {
  const isHere = useIsHere();
  const here = module.items.some((i, n) => isHere(i.href, n === 0));
  const [open, setOpen] = useState(here);
  useEffect(() => {
    if (here) setOpen(true);
  }, [here]);
  const id = `nav-module-${module.key}`;
  const Icon = module.Icon;
  return (
    <li className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        className={cx(
          'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-body font-medium text-white/95 transition-all duration-200 hover:bg-white/10',
          here && 'bg-white/10',
        )}
      >
        <Icon
          aria-hidden
          className={cx(
            'size-5 shrink-0 transition-transform duration-200 group-hover:scale-110',
            here ? 'text-cyan-400' : 'text-white/60',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left">{module.label}</span>
        <ChevronDown
          aria-hidden
          className={cx(
            '-ml-1 size-4 shrink-0 text-white/60 transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      <ul
        id={id}
        hidden={!open}
        className="ml-4 flex flex-col gap-0.5 border-l border-white/15 py-0.5 pl-4"
      >
        {module.items.map(({ href, label, Icon: ChildIcon }, n) => {
          const current = isHere(href, n === 0);
          return (
            <li key={href}>
              <Link
                href={href}
                {...(onNavigate ? { onClick: onNavigate } : {})}
                aria-current={current ? 'page' : undefined}
                className={cx(
                  'group/child relative flex items-center gap-3 rounded-lg px-3 py-2 text-body transition-all duration-150',
                  current
                    ? 'bg-cyan-400 text-midnight-950 shadow-[0_2px_8px_rgba(10,197,255,0.25)]'
                    : 'text-white/75 hover:bg-white/10 hover:text-white/95',
                )}
              >
                {current && (
                  <span
                    aria-hidden
                    className="absolute top-1.5 bottom-1.5 -left-[17.5px] w-[3px] rounded-full bg-cyan-400"
                  />
                )}
                <ChildIcon
                  aria-hidden
                  className={cx(
                    'size-4 shrink-0 transition-transform duration-200 group-hover/child:scale-110',
                    current ? 'text-midnight-950' : 'text-white/60',
                  )}
                />
                <span className="transition-transform duration-200 group-hover/child:translate-x-0.5">
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

function NavModules({ modules, onNavigate }: { modules: NavModule[]; onNavigate?: () => void }) {
  const singles = (list: NavModule[]) => list.flatMap((m) => m.items);
  // Runs of one-page modules render as plain rows; a module with several pages folds.
  return (
    <ul className="flex flex-col gap-0.5">
      {modules.map((m) =>
        m.items.length === 1 ? (
          <li key={m.key}>
            <NavList items={singles([m])} {...(onNavigate ? { onNavigate } : {})} />
          </li>
        ) : (
          <NavModuleRow key={m.key} module={m} {...(onNavigate ? { onNavigate } : {})} />
        ),
      )}
    </ul>
  );
}

/** A system's modules under its name; the name folds the section away (remembered on this device). */
function NavGroup({ group, onNavigate }: { group: NavSection; onNavigate?: () => void }) {
  const isHere = useIsHere();
  const storeKey = `cv.nav.${group.key}`;
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    try {
      setClosed(localStorage.getItem(storeKey) === 'closed');
    } catch {
      // Storage can be blocked; the group simply stays open.
    }
  }, [storeKey]);
  const here = group.modules.some((m) => m.items.some((i, n) => isHere(i.href, n === 0)));
  const open = !closed || here;
  const toggle = () => {
    const next = !closed;
    setClosed(next);
    try {
      localStorage.setItem(storeKey, next ? 'closed' : 'open');
    } catch {
      // As above.
    }
  };
  if (!group.group)
    return <NavModules modules={group.modules} {...(onNavigate ? { onNavigate } : {})} />;
  const id = `nav-${group.key}`;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={id}
        disabled={here}
        className="flex items-center justify-between rounded-md px-3 pt-3 pb-1 text-[10px] font-semibold tracking-[0.18em] text-white/60 uppercase hover:text-white/80 disabled:cursor-default disabled:hover:text-white/60"
      >
        {group.group}
        {!here && (
          <ChevronDown
            aria-hidden
            className={cx(
              'size-3.5 transition-transform motion-reduce:transition-none',
              !open && '-rotate-90',
            )}
          />
        )}
      </button>
      <div id={id} hidden={!open}>
        <NavModules modules={group.modules} {...(onNavigate ? { onNavigate } : {})} />
      </div>
    </div>
  );
}

type Me = { name: string; orgName: string; roles: string[]; photoFileId: string | null };
type ScopeTree = {
  organisation: { orgId: string; name: string };
  campuses: {
    campusId: string;
    name: string;
    institutions: { institutionId: string; name: string }[];
  }[];
};
type FoundStudent = { personId: string; name: string; placement: string | null };

/**
 * Signed in, the sidebar shows the real organisation, its campuses and institutions, and the
 * person, with Sign out. Without a session (the design-review pages) it shows the synthetic school.
 */
function Sidebar({
  scopeId,
  onScope,
  onNavigate,
  signedIn,
  dev,
}: {
  scopeId: string;
  onScope: (id: string) => void;
  onNavigate?: () => void;
  signedIn: boolean;
  dev: boolean;
}) {
  const router = useRouter();
  const { announce, openPalette } = useSchoolActions();
  const { can } = useMe(signedIn);
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/people/me'),
    enabled: signedIn,
  });
  const tree = useQuery({
    queryKey: ['scope-tree'],
    queryFn: () => api.get<ScopeTree>('/school/setup/tree'),
    enabled: signedIn,
  });
  const chosen = useInstitution(signedIn);
  const real = signedIn && me.data && tree.data;
  const options: ScopeOption[] = real
    ? tree.data.campuses.flatMap((c) =>
        c.institutions.map((i) => ({
          id: i.institutionId,
          institution: i.name,
          campus: `${tree.data.organisation.name} · ${c.name}`,
          year: '',
        })),
      )
    : scopes;
  const scope = real
    ? (options.find((o) => o.id === chosen.institutionId) ?? options[0] ?? defaultScope)
    : (options.find((o) => o.id === scopeId) ?? options[0] ?? defaultScope);

  const signOut = async () => {
    // Unsent offline attendance would be lost with the session: send it first.
    const unsent = await pending().catch(() => []);
    if (unsent.length > 0) {
      announce(en.attendance.unsentSignOut(unsent.length));
      return;
    }
    await session.post('logout', {}).catch(() => undefined);
    router.replace('/login');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-6">
        <Image
          src={logoWhite}
          alt={en.app.name}
          width={101}
          height={32}
          priority
          className="h-8 w-auto"
        />
      </div>
      <div className="border-b border-white/10 px-4 pb-3">
        <ScopeChip
          value={scope}
          options={options}
          onChange={(id) => (real ? chooseInstitution(id) : onScope(id))}
          label={en.app.scope}
          dark
        />
      </div>
      <nav aria-label={en.app.nav} className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        {navFor(profileOf(real ? chosen.profile : undefined), can).map((g) => (
          <NavGroup key={g.key} group={g} {...(onNavigate ? { onNavigate } : {})} />
        ))}
        <div className="flex flex-col gap-1">
          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-[0.18em] text-white/60 uppercase">
            {en.systems.groups.ai}
          </p>
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              openPalette();
            }}
            className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-body font-medium text-white/95 transition-all hover:bg-white/10"
          >
            <Sparkles aria-hidden className="size-5 shrink-0 text-cyan-400" />
            {en.nav.verse}
          </button>
        </div>
        {dev && (
          <div className="flex flex-col gap-1">
            <p className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-[0.18em] text-white/60 uppercase">
              {en.nav.groups.developer}
            </p>
            <NavList items={DEV_NAV} {...(onNavigate ? { onNavigate } : {})} />
          </div>
        )}
      </nav>
      {signedIn && (
        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={() => void signOut()}
            className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-body font-medium text-[#ff9b9b] transition-all hover:bg-white/10"
          >
            <LogOut aria-hidden className="size-5 shrink-0" />
            {en.user.signOut}
          </button>
        </div>
      )}
    </div>
  );
}

export function SchoolShell({
  children,
  signedIn,
  dev,
}: {
  children: ReactNode;
  signedIn: boolean;
  /** Development: shows the design system link. */
  dev: boolean;
}) {
  const router = useRouter();
  const [scopeId, setScopeId] = useState(defaultScope.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ask, setAsk] = useState<AskState | null>(null);
  /** The Verse AI panel, with a question to start on (from Ctrl K), or empty. */
  const [panel, setPanel] = useState<{ question: string | null } | null>(null);
  const pathname = usePathname();
  const { institutionId } = useInstitution(signedIn);
  const askVerse = (question: string) => {
    if (!signedIn) {
      setAsk({ status: 'failed', question, error: 'signed_out' });
      return;
    }
    if (!institutionId) {
      setAsk({ status: 'failed', question, error: new Error('no school') });
      return;
    }
    // Signed in, the question opens the Verse AI panel, where actions can be confirmed.
    setPaletteOpen(false);
    setPanel({ question });
  };

  const announce = useCallback((m: string) => setMessage(m), []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const actions: Actions = {
    openRemind: () => setRemindOpen(true),
    openStudent: setStudentId,
    announce,
    openPalette: () => setPaletteOpen(true),
  };
  // Without a session (design review) the palette, canvas and drawer show the synthetic school.
  const student = signedIn ? undefined : students.find((s) => s.id === studentId);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(h);
  }, [query]);
  const found = useQuery({
    queryKey: ['palette-students', institutionId, debounced],
    queryFn: () =>
      api.get<FoundStudent[]>(
        `/people/students?institutionId=${institutionId}&search=${encodeURIComponent(debounced)}`,
      ),
    enabled: signedIn && !!institutionId && debounced.length >= 2,
  });
  const go = (href: string) => () => router.push(href);

  const commands: CommandItem[] = signedIn
    ? [
        ...(found.data ?? []).slice(0, 8).map((s) => ({
          id: `student-${s.personId}`,
          group: 'find' as const,
          label: s.name,
          ...(s.placement ? { hint: s.placement } : {}),
          keywords: [debounced],
          onSelect: go(`/students/${s.personId}`),
        })),
        {
          id: 'do-attendance',
          group: 'do',
          label: en.command.takeAttendance,
          keywords: ['attendance', 'absent', 'register'],
          onSelect: go('/attendance'),
        },
        {
          id: 'do-fee',
          group: 'do',
          label: en.command.collectFee,
          keywords: ['fee', 'pay', 'receipt'],
          onSelect: go('/fees'),
        },
        {
          id: 'do-notice',
          group: 'do',
          label: en.command.sendNotice,
          keywords: ['notice', 'circular', 'message'],
          onSelect: go('/notices/new'),
        },
        {
          id: 'do-setup',
          group: 'do',
          label: en.command.setUp,
          keywords: ['setup', 'classes', 'import', 'students', 'staff'],
          onSelect: go('/setup'),
        },
      ]
    : [
        ...students.map((s) => ({
          id: `student-${s.id}`,
          group: 'find' as const,
          label: s.name,
          hint: `${en.student.class} ${s.klass}`,
          keywords: [s.klass, s.guardian],
          onSelect: () => setStudentId(s.id),
        })),
        {
          id: 'do-remind',
          group: 'do',
          label: en.remind.action(unmarkedSections.length),
          keywords: ['attendance', 'remind', 'teachers'],
          onSelect: () => setRemindOpen(true),
        },
      ];

  return (
    <ActionsContext.Provider value={actions}>
      <div className="flex min-h-dvh">
        <aside className="midnight sticky top-(--env-bar) hidden h-[calc(100dvh-var(--env-bar))] w-[260px] shrink-0 lg:block">
          <Sidebar scopeId={scopeId} onScope={setScopeId} signedIn={signedIn} dev={dev} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-(--env-bar) z-30 h-16 border-b border-line/50 bg-white/80 backdrop-blur-xl">
            <div className="flex h-full items-center gap-2 px-4 lg:px-6">
              <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
                <Dialog.Trigger
                  aria-label={en.app.menu}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-paper lg:hidden"
                >
                  <Menu aria-hidden className="size-5" />
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25" />
                  <Dialog.Content className="midnight fixed inset-y-0 left-0 z-50 w-72 shadow-[var(--shadow-overlay)] outline-none">
                    <Dialog.Title className="sr-only">{en.app.nav}</Dialog.Title>
                    <Dialog.Description className="sr-only">{en.app.nav}</Dialog.Description>
                    <Dialog.Close
                      aria-label={en.app.closeMenu}
                      className="absolute top-5 right-3 flex size-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/10"
                    >
                      <X aria-hidden className="size-4" />
                    </Dialog.Close>
                    <Sidebar
                      signedIn={signedIn}
                      dev={dev}
                      scopeId={scopeId}
                      onScope={setScopeId}
                      onNavigate={() => setMenuOpen(false)}
                    />
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
              <Image src={iconColor} alt="" className="size-7 lg:hidden" />

              <div className="flex flex-1 justify-end sm:justify-start">
                <CommandTrigger onOpen={() => setPaletteOpen(true)} labels={en.command} />
              </div>

              {signedIn && (
                <button
                  type="button"
                  aria-label={en.verse.openPanel}
                  title={en.verse.openPanel}
                  onClick={() => setPanel({ question: null })}
                  className="relative rounded-xl p-2.5 text-ink-muted transition-colors hover:bg-navy-50 hover:text-ink"
                >
                  <Sparkles aria-hidden className="size-5" />
                  <span
                    aria-hidden
                    className="absolute right-1.5 bottom-1.5 size-2 rounded-full bg-cyan-400 ring-2 ring-white"
                  />
                </button>
              )}
              {signedIn && <NewMenu />}
              {signedIn && <ProfileMenu />}
            </div>
          </header>

          <main id="main" className="flex-1">
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</div>
          </main>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={commands}
        onAsk={askVerse}
        onQueryChange={setQuery}
        answer={ask && <VerseAnswerView state={ask} onNavigate={() => setPaletteOpen(false)} />}
        labels={en.command}
      />

      <PreviewCanvas
        open={remindOpen}
        onOpenChange={setRemindOpen}
        title={en.remind.title}
        actionLabel={en.remind.action(unmarkedSections.length)}
        changes={[
          ...en.remind.changes,
          ...unmarkedSections.map((u) => `${u.section}: ${u.teacher}`),
        ]}
        affected={[
          { label: en.remind.affectedTeachers, count: unmarkedSections.length },
          { label: en.remind.affectedSections, count: unmarkedSections.length },
          { label: en.remind.affectedParents, count: 0 },
        ]}
        risks={[en.remind.risk(absentTeacher.name, absentTeacher.section)]}
        undo={en.remind.undo}
        labels={en.preview}
        onConfirm={() => {
          setRemindOpen(false);
          announce(en.remind.done(unmarkedSections.length));
        }}
      />

      <RecordDrawer
        open={!!panel}
        onOpenChange={(o) => !o && setPanel(null)}
        title={en.verse.panel}
        subtitle={en.verse.panelOn(pathname)}
        closeLabel={en.drawer.close}
      >
        {panel && (
          <VerseChat
            page={pathname}
            compact
            startWith={panel.question}
            onNavigate={() => setPanel(null)}
          />
        )}
      </RecordDrawer>

      <RecordDrawer
        open={!!student}
        onOpenChange={(o) => !o && setStudentId(null)}
        title={student?.name ?? ''}
        subtitle={
          student ? `${en.student.class} ${student.klass} · ${en.student.roll} ${student.roll}` : ''
        }
        closeLabel={en.drawer.close}
      >
        {student && (
          <dl className="flex flex-col divide-y divide-line">
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-ink-muted">{en.student.guardian}</dt>
              <dd className="text-right font-medium">{student.guardian}</dd>
            </div>
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-ink-muted">{en.student.attendance}</dt>
              <dd className="tabular font-medium">{student.attendance}</dd>
            </div>
            <p className="py-3 text-caption text-ink-muted">{en.student.note}</p>
          </dl>
        )}
      </RecordDrawer>

      <Announcer message={message} />
    </ActionsContext.Provider>
  );
}
