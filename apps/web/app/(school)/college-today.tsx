'use client';

// Today for a college or university (rule book §12.3: the profile switches modules and words):
// the greeting, getting started until the essentials are in place (a programme with a published
// regulation, a batch with students, staff, the fee plan, programme outcomes), the key numbers and
// the jobs a college does most.
import type { StructureOverview } from '@campusverse/academics-structure';
import { KeyFigures, PageHeader, StatePanel, type KeyFigure } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import {
  BookCheck,
  BriefcaseBusiness,
  CalendarCheck,
  ClipboardList,
  GraduationCap,
  IndianRupee,
  Inbox,
  Layers,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { api } from '../../lib/api';
import { en } from '../../messages/en';
import { useInstitution } from './attendance/shared';
import { QuickPills, SetupChecklist } from './dashboard-kit';
import { InvitesStep } from './setup/invites-ready';
import { keys, type InvitePreview } from './setup/shared';

const t = en.home.college;
const num = new Intl.NumberFormat('en-IN');
const dateInIndia = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Asia/Kolkata',
});

export function CollegeToday() {
  const school = useInstitution();
  const id = school.institutionId;
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ name: string }>('/people/me'),
  });
  const overview = useQuery({
    queryKey: ['academics', id],
    queryFn: () => api.get<StructureOverview>(`/academics/structure?institutionId=${id}`),
    enabled: !!id,
  });
  const staff = useQuery({
    queryKey: ['staff', id, 'home'],
    queryFn: () => api.get<unknown[]>(`/people/staff?institutionId=${id}`),
    enabled: !!id,
    retry: false,
  });
  const plans = useQuery({
    queryKey: ['fee-plans', id, 'home'],
    queryFn: () => api.get<unknown[]>(`/finance/${id}/plans`),
    enabled: !!id,
    retry: false,
  });
  // Staff who can't sign in yet: the same invitations as a school's setup (hidden without the right).
  const invites = useQuery({
    queryKey: keys.invites(id ?? ''),
    queryFn: () => api.get<InvitePreview>(`/school/setup/${id}/invites`),
    enabled: !!id,
    retry: false,
  });
  const firstProgram = overview.data?.programs[0]?.id;
  const outcomes = useQuery({
    queryKey: ['outcome-sets', firstProgram, 'home'],
    queryFn: () =>
      api.get<{ status: string }[]>(`/academics/programs/${firstProgram}/outcome-sets`),
    enabled: !!firstProgram,
    retry: false,
  });

  if (school.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (school.isError || !id)
    return <StatePanel kind="error" title={en.home.errorTitle} body={en.home.errorBody} />;

  const o = overview.data;
  const programs = o?.programs ?? [];
  const running = (o?.batches ?? []).filter((b) => b.status === 'running');
  const students = running.reduce((n, b) => n + b.students, 0);
  const published = programs.some((p) => p.regulations.some((r) => r.status === 'published'));
  const checks = o
    ? [
        { key: 'program', ok: programs.length > 0, href: '/academic-structure' },
        { key: 'regulation', ok: published, href: '/academic-structure' },
        { key: 'batch', ok: running.length > 0, href: '/academic-structure' },
        { key: 'students', ok: students > 0, href: '/academic-structure' },
        { key: 'staff', ok: (staff.data?.length ?? 0) > 0, href: '/staff' },
        { key: 'fees', ok: (plans.data?.length ?? 0) > 0, href: '/fees/plans' },
        {
          key: 'outcomes',
          ok: (outcomes.data ?? []).some((s) => s.status === 'published'),
          href: '/obe?tab=outcomes',
        },
      ].map((c) => ({ ...c, title: t.steps[c.key] ?? c.key }))
    : [];
  const figures: KeyFigure[] = o
    ? [
        { label: t.figures.programs, value: num.format(programs.length), icon: Layers },
        { label: t.figures.batches, value: num.format(running.length), icon: CalendarCheck },
        { label: t.figures.students, value: num.format(students), icon: GraduationCap },
        ...(staff.data
          ? [{ label: t.figures.staff, value: num.format(staff.data.length), icon: Users }]
          : []),
      ]
    : [];
  const hour = Number(
    new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    }).format(new Date()),
  );
  return (
    <div className="flex flex-col gap-10 pb-12">
      <PageHeader
        eyebrow={`${school.institutionName ?? ''} · ${dateInIndia.format(new Date())}`}
        title={me.data ? en.home.greetingName(en.greeting(hour), me.data.name) : en.home.title}
        description={t.lead}
        icon={Sparkles}
        dark
      />
      {checks.length > 0 && <SetupChecklist checks={checks} group={t.group} bodies={t.bodies} />}
      {invites.data && invites.data.staff + invites.data.guardians > 0 && (
        <InvitesStep institutionId={id} />
      )}
      <KeyFigures
        variant="strip"
        figures={figures}
        label={en.home.figures}
        loading={overview.isPending}
      />
      <QuickPills
        items={[
          { key: 'courseAttendance', href: '/course-attendance', icon: CalendarCheck },
          { key: 'registration', href: '/course-registration', icon: ClipboardList },
          { key: 'examResults', href: '/exam-results', icon: BookCheck },
          { key: 'obe', href: '/obe', icon: Target },
          { key: 'fee', href: '/fees', icon: IndianRupee },
          { key: 'staffList', href: '/staff', icon: BriefcaseBusiness },
          { key: 'myWork', href: '/my-work', icon: Inbox },
        ]}
      />
    </div>
  );
}
