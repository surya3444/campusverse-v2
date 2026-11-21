// The public landing page: the story of campusverse.app, told with the product's real screens.
// Only what the product does today is claimed (rule book §17); what is coming says so.
import { IconTile, cx, type Area } from '@campusverse/ui';
import {
  BadgeCheck,
  BookCheck,
  Briefcase,
  Building2,
  Bus,
  CalendarRange,
  Check,
  Database,
  FileBadge,
  HeartPulse,
  IndianRupee,
  KeyRound,
  Landmark,
  LayoutGrid,
  Lock,
  Network,
  School,
  ScrollText,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import { BrandMark } from '../login/brand-mark';
import { SYSTEMS } from '../../lib/systems';
import { en } from '../../messages/en';
import { RoleTabs } from './role-tabs';
import { ModuleDirectory, SystemsGrid } from '../product/directory';
import {
  DEMO,
  FOCUS_DARK,
  PrimaryLink,
  SecondaryLink,
  SectionHead,
  SHELL,
  SiteFooter,
  SiteHeader,
  SkipLink,
} from './site';

const t = en.landing;
const LIVE = SYSTEMS.flatMap((x) => x.apps).filter((a) => a.status === 'live');

/** A real screen in a browser frame. */
function BrowserFrame({
  src,
  width,
  height,
  alt,
  priority = false,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  priority?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-[1.1rem] border border-line bg-surface shadow-[0_40px_100px_-30px_rgb(4_38_109/0.45)]">
      <div className="flex h-10 items-center gap-3 border-b border-line bg-paper px-4">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-navy-200" />
          <span className="size-2.5 rounded-full bg-navy-200" />
          <span className="size-2.5 rounded-full bg-navy-200" />
        </span>
        <span className="mx-auto flex min-w-0 items-center gap-1.5 rounded-md bg-surface px-3 py-1 text-[0.6875rem] text-ink-muted ring-1 ring-line">
          <Lock aria-hidden className="size-3" />
          <span className="truncate">{t.hero.url}</span>
        </span>
        <span aria-hidden className="w-[2.6rem]" />
      </div>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        sizes="(min-width: 1240px) 1100px, 100vw"
        className="h-auto w-full"
      />
    </div>
  );
}

function Callout({ title, body, className }: { title: string; body: string; className?: string }) {
  return (
    <div
      className={cx(
        'absolute hidden max-w-[15rem] rounded-xl bg-surface p-3.5 text-left shadow-[0_20px_50px_-15px_rgb(4_38_109/0.35)] ring-1 ring-line xl:block',
        className,
      )}
    >
      <p className="flex items-center gap-2 text-caption font-semibold text-ink">
        <span aria-hidden className="size-2 rounded-full bg-cyan-400 ring-4 ring-cyan-200/60" />
        {title}
      </p>
      <p className="mt-1 text-caption text-ink-muted">{body}</p>
    </div>
  );
}

const PILLAR_ICON: LucideIcon[] = [LayoutGrid, HeartPulse, Briefcase];
const PILLAR_AREA: Area[] = ['navy', 'rose', 'violet'];
const TOUR_ICONS = [IndianRupee, Bus, BookCheck, Users, CalendarRange, FileBadge];
const TOUR_AREA: Area[] = ['go', 'amber', 'sky', 'teal', 'rose', 'violet'];
const TRUST_ICONS = [Database, Network, BadgeCheck, ScrollText, HeartPulse, KeyRound];
const SEGMENT_ICONS = [School, Building2, Landmark, Network];
const SEGMENT_AREA: Area[] = ['sky', 'violet', 'teal', 'amber'];

export function Landing() {
  const stats = t.hero.stats(LIVE.length);
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <SkipLink />
      <SiteHeader />

      <main id="main">
        {/* Hero: the promise, then the real product spilling over the edge. */}
        <section
          aria-labelledby="hero-title"
          className="midnight relative isolate overflow-hidden text-white"
        >
          <span
            aria-hidden
            className="absolute -top-64 left-1/2 -z-10 aspect-square w-[70rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(10_197_255/0.2),transparent_60%)]"
          />
          <BrandMark className="pointer-events-none absolute -top-40 -left-72 -z-10 hidden w-[44rem] opacity-25 lg:block" />
          <BrandMark className="pointer-events-none absolute -right-72 bottom-24 -z-10 hidden w-[40rem] opacity-20 lg:block" />
          <div
            className={cx(
              SHELL,
              'flex flex-col items-center pt-16 pb-56 text-center sm:pt-24 sm:pb-72 lg:pb-[24rem]',
            )}
          >
            <p className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1.5 text-caption font-medium text-white/90 ring-1 ring-white/15">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_var(--color-cyan-400)]"
              />
              {t.hero.eyebrow}
            </p>
            <h1
              id="hero-title"
              className="mt-7 font-display text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.045em] sm:text-[4.25rem] lg:text-[5rem]"
            >
              {t.hero.title.map((line, i) => (
                <span key={line} className={cx('block', i === 2 && 'text-cyan-200')}>
                  {line}{' '}
                </span>
              ))}
            </h1>
            <p className="mt-7 max-w-2xl text-lead text-white/75">{t.hero.lead}</p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <PrimaryLink href="/signup" dark>
                {t.hero.start}
              </PrimaryLink>
              <SecondaryLink href={DEMO} dark>
                {t.hero.demo}
              </SecondaryLink>
            </div>
            <dl className="mt-12 grid w-full max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/10 sm:grid-cols-4">
              {stats.map(([value, label]) => (
                <div key={label} className="flex flex-col-reverse bg-midnight-950/70 px-4 py-4">
                  <dt className="mt-1.5 text-caption text-white/70">{label}</dt>
                  <dd className="tabular font-display text-[1.75rem] leading-none font-semibold text-white">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
        <div className={cx(SHELL, 'relative -mt-44 sm:-mt-60 lg:-mt-[20rem]')}>
          <div className="relative mx-auto max-w-[1100px]">
            <BrowserFrame
              src="/landing/today-desktop.png"
              width={2880}
              height={1748}
              alt={t.hero.shotLabel}
              priority
            />
            <div className="absolute -right-3 -bottom-10 hidden w-[200px] overflow-hidden rounded-[2rem] border-[7px] border-navy-950 bg-navy-950 shadow-[0_30px_70px_-20px_rgb(4_38_109/0.6)] md:block lg:-right-10 lg:w-[230px]">
              <div className="aspect-[390/760] overflow-hidden rounded-[1.5rem] bg-surface">
                <Image
                  src="/landing/today-phone.png"
                  alt={t.hero.phoneLabel}
                  width={780}
                  height={1636}
                  sizes="230px"
                  className="h-auto w-full"
                />
              </div>
            </div>
            <Callout
              title={t.hero.callouts[0]?.[0] ?? ''}
              body={t.hero.callouts[0]?.[1] ?? ''}
              className="top-[42%] -left-24"
            />
            <Callout
              title={t.hero.callouts[1]?.[0] ?? ''}
              body={t.hero.callouts[1]?.[1] ?? ''}
              className="-bottom-6 -left-16"
            />
          </div>
        </div>

        {/* The three pillars */}
        <section
          id="products"
          aria-labelledby="products-title"
          className="scroll-mt-24 pt-28 pb-20 sm:pt-36 sm:pb-28"
        >
          <div className={SHELL}>
            <SectionHead
              id="products-title"
              eyebrow={t.pillars.eyebrow}
              title={t.pillars.title}
              center
            />
            <ul className="mt-14 grid gap-5 lg:grid-cols-3">
              {t.pillars.items.map((p, i) => {
                const Icon = PILLAR_ICON[i] ?? LayoutGrid;
                const featured = p.status === 'live';
                return (
                  <li
                    key={p.name}
                    className={cx(
                      'relative isolate flex flex-col gap-5 overflow-hidden rounded-[1.5rem] p-7 sm:p-8',
                      featured
                        ? 'midnight text-white'
                        : 'border border-line bg-surface shadow-[var(--shadow-card)]',
                    )}
                  >
                    {featured && (
                      <BrandMark className="pointer-events-none absolute -right-24 -bottom-28 -z-10 w-[22rem] opacity-25" />
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <IconTile icon={Icon} area={PILLAR_AREA[i] ?? 'navy'} />
                      <span
                        className={cx(
                          'rounded-full px-2.5 py-1 text-caption font-semibold',
                          p.status === 'live'
                            ? 'bg-signal-go-tint text-signal-go-ink'
                            : p.status === 'building'
                              ? 'bg-signal-warn-tint text-signal-warn-ink'
                              : 'bg-navy-50 text-navy-950',
                        )}
                      >
                        {t.pillars[p.status]}
                      </span>
                    </div>
                    <h3
                      className={cx(
                        'font-display text-[1.5rem] font-semibold tracking-[-0.02em]',
                        featured ? 'text-white' : 'text-ink',
                      )}
                    >
                      {p.name}
                    </h3>
                    <p className={cx('text-body', featured ? 'text-white/75' : 'text-ink-muted')}>
                      {p.lead}
                    </p>
                    <ul className="mt-auto flex flex-col gap-2.5">
                      {p.points.map((pt) => (
                        <li
                          key={pt}
                          className={cx(
                            'flex items-start gap-2.5 text-body',
                            featured ? 'text-white/90' : 'text-ink',
                          )}
                        >
                          <Check
                            aria-hidden
                            className={cx(
                              'mt-0.5 size-4 shrink-0',
                              featured ? 'text-cyan-200' : 'text-signal-go-ink',
                            )}
                          />
                          {pt}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* The nine systems */}
        <section
          id="systems"
          aria-labelledby="systems-title"
          className="scroll-mt-24 pb-20 sm:pb-28"
        >
          <div className={SHELL}>
            <SectionHead
              id="systems-title"
              eyebrow={t.systems.eyebrow}
              title={t.systems.title}
              lead={t.systems.lead}
            />
            <div className="mt-12">
              <SystemsGrid />
            </div>
          </div>
        </section>

        {/* Every module, by system */}
        <section
          id="modules"
          aria-labelledby="modules-title"
          className="scroll-mt-24 border-y border-line bg-surface py-20 sm:py-28"
        >
          <div className={SHELL}>
            <SectionHead
              id="modules-title"
              eyebrow={t.modules.eyebrow}
              title={t.modules.title(LIVE.length)}
              lead={t.modules.lead}
            />
            <div className="mt-12">
              <ModuleDirectory />
            </div>
          </div>
        </section>

        {/* Built deep: the timetable generator, then the rest */}
        <section aria-labelledby="tour-title" className="py-20 sm:py-28">
          <div className={SHELL}>
            <SectionHead id="tour-title" eyebrow={t.tour.eyebrow} title={t.tour.title} />
            <div className="mt-12 grid items-center gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <div className="flex flex-col gap-4">
                <IconTile icon={CalendarRange} area="violet" />
                <h3 className="font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
                  {t.tour.timetable.title}
                </h3>
                <p className="text-lead text-ink-muted">{t.tour.timetable.lead}</p>
              </div>
              <BrowserFrame
                src="/landing/timetable-generator.png"
                width={1151}
                height={867}
                alt={t.tour.timetable.label}
              />
            </div>
            <ul className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {t.tour.items.map(([title, body], i) => {
                const Icon = TOUR_ICONS[i] ?? LayoutGrid;
                return (
                  <li
                    key={title}
                    className="lift flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]"
                  >
                    <IconTile icon={Icon} area={TOUR_AREA[i] ?? 'navy'} />
                    <h3 className="font-display text-lead font-semibold text-ink">{title}</h3>
                    <p className="text-body text-ink-muted">{body}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Roles */}
        <section
          aria-labelledby="roles-title"
          className="border-t border-line bg-surface py-20 sm:py-28"
        >
          <div className={SHELL}>
            <SectionHead
              id="roles-title"
              eyebrow={t.roles.eyebrow}
              title={t.roles.title}
              lead={t.roles.lead}
            />
            <RoleTabs />
          </div>
        </section>

        {/* Verse AI */}
        <section
          id="ai"
          aria-labelledby="ai-title"
          className="midnight relative isolate scroll-mt-24 overflow-hidden py-20 text-white sm:py-28"
        >
          <span
            aria-hidden
            className="absolute -top-40 left-1/3 -z-10 aspect-square w-[46rem] rounded-full bg-[radial-gradient(circle,rgb(10_197_255/0.18),transparent_60%)]"
          />
          <div className={cx(SHELL, 'grid items-center gap-12 lg:grid-cols-2')}>
            <div className="flex flex-col gap-8">
              <SectionHead
                id="ai-title"
                eyebrow={t.ai.eyebrow}
                title={t.ai.title}
                lead={t.ai.lead}
                dark
              />
              <ul className="grid gap-4 sm:grid-cols-2">
                {t.ai.principles.map(([title, body]) => (
                  <li key={title} className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
                    <p className="flex items-center gap-2 font-semibold text-white">
                      <Check aria-hidden className="size-4 text-cyan-200" />
                      {title}
                    </p>
                    <p className="mt-1.5 text-caption text-white/70">{body}</p>
                  </li>
                ))}
              </ul>
            </div>
            <figure
              aria-label={t.ai.verse}
              className="rounded-[1.4rem] border border-white/15 bg-white/[0.06] p-2 backdrop-blur"
            >
              <ol className="flex flex-col gap-3 rounded-2xl bg-surface p-5 sm:p-6">
                {t.ai.chat.map(([who, text], i) => (
                  <li
                    key={i}
                    className={cx('flex', who === 'you' ? 'justify-end' : 'justify-start')}
                  >
                    <p
                      className={cx(
                        'max-w-[85%] rounded-2xl px-4 py-2.5 text-body',
                        who === 'you'
                          ? 'rounded-br-md bg-navy-950 text-white'
                          : 'rounded-bl-md bg-navy-50 text-ink',
                      )}
                    >
                      <span className="sr-only">{who === 'you' ? t.ai.you : t.ai.verse}: </span>
                      {text}
                    </p>
                  </li>
                ))}
              </ol>
            </figure>
          </div>
        </section>

        {/* Multi-branch */}
        <section aria-labelledby="branches-title" className="py-20 sm:py-28">
          <div className={cx(SHELL, 'grid items-center gap-12 lg:grid-cols-2')}>
            <div className="flex flex-col gap-8">
              <SectionHead
                id="branches-title"
                eyebrow={t.branches.eyebrow}
                title={t.branches.title}
                lead={t.branches.lead}
              />
              <ul className="grid gap-5 sm:grid-cols-2">
                {t.branches.points.map(([title, body]) => (
                  <li key={title}>
                    <p className="flex items-center gap-2 font-display text-body font-semibold text-ink">
                      <Check aria-hidden className="size-4 text-signal-go-ink" />
                      {title}
                    </p>
                    <p className="mt-1 text-body text-ink-muted">{body}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div
              aria-hidden
              className="rounded-[1.75rem] border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8"
            >
              <div className="mx-auto flex w-fit items-center gap-3 rounded-2xl bg-navy-950 px-5 py-3.5 text-white">
                <Landmark className="size-5 text-cyan-200" />
                <span className="font-display font-semibold">{t.branches.tree.hq}</span>
              </div>
              <div className="mx-auto h-8 w-px bg-line-strong" />
              <div className="mx-auto h-px w-[68%] bg-line-strong" />
              <div className="grid grid-cols-3 gap-3">
                {t.branches.tree.campuses.map((c, i) => (
                  <div key={c} className="flex flex-col items-center">
                    <span className="h-6 w-px bg-line-strong" />
                    <div className="w-full rounded-xl border border-line bg-paper p-3 text-center">
                      <p className="text-caption font-semibold text-ink">{c}</p>
                      <p className="mt-1 text-[0.6875rem] text-ink-muted">
                        {t.branches.tree.kinds[i]}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Trust */}
        <section
          aria-labelledby="trust-title"
          className="border-y border-line bg-surface py-20 sm:py-28"
        >
          <div className={SHELL}>
            <SectionHead id="trust-title" eyebrow={t.trust.eyebrow} title={t.trust.title} />
            <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {t.trust.items.map(([title, body], i) => {
                const Icon = TRUST_ICONS[i] ?? Lock;
                return (
                  <li key={title} className="flex gap-4 bg-surface p-6">
                    <IconTile icon={Icon} area="navy" />
                    <div>
                      <h3 className="font-display text-body font-semibold text-ink">{title}</h3>
                      <p className="mt-1 text-body text-ink-muted">{body}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Segments and languages */}
        <section
          id="segments"
          aria-labelledby="segments-title"
          className="scroll-mt-24 py-20 sm:py-28"
        >
          <div className={SHELL}>
            <SectionHead
              id="segments-title"
              eyebrow={t.segments.eyebrow}
              title={t.segments.title}
              lead={t.segments.lead}
            />
            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {t.segments.items.map(([title, body], i) => {
                const Icon = SEGMENT_ICONS[i] ?? School;
                return (
                  <li
                    key={title}
                    className="lift flex flex-col gap-3 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]"
                  >
                    <IconTile icon={Icon} area={SEGMENT_AREA[i] ?? 'navy'} />
                    <h3 className="font-display text-lead font-semibold text-ink">{title}</h3>
                    <p className="text-body text-ink-muted">{body}</p>
                  </li>
                );
              })}
            </ul>
            <div className="mt-14 flex flex-col items-center gap-5 text-center">
              <p className="text-body font-medium text-ink-muted">{t.languages.title}</p>
              <ul className="flex flex-wrap justify-center gap-x-8 gap-y-3">
                {t.languages.list.map((l) => (
                  <li key={l} className="font-display text-[1.6rem] font-semibold text-ink">
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Rollout */}
        <section
          aria-labelledby="rollout-title"
          className="border-y border-line bg-surface py-20 sm:py-28"
        >
          <div className={SHELL}>
            <SectionHead
              id="rollout-title"
              eyebrow={t.rollout.eyebrow}
              title={t.rollout.title}
              lead={t.rollout.lead}
              center
            />
            <ol className="relative mt-14 grid gap-8 md:grid-cols-3 md:gap-5">
              <span
                aria-hidden
                className="absolute top-7 right-[16%] left-[16%] hidden h-px bg-line-strong md:block"
              />
              {t.rollout.steps.map(([when, title, body], i) => (
                <li key={title} className="relative flex flex-col items-center gap-3 text-center">
                  <span className="relative flex size-14 items-center justify-center rounded-full bg-navy-950 font-display text-lead font-semibold text-white ring-8 ring-surface">
                    {i + 1}
                  </span>
                  <p className="text-caption font-semibold tracking-wide text-navy-700 uppercase">
                    {when}
                  </p>
                  <h3 className="font-display text-[1.4rem] font-semibold text-ink">{title}</h3>
                  <p className="max-w-xs text-body text-ink-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pricing */}
        <section
          id="pricing"
          aria-labelledby="pricing-title"
          className="scroll-mt-24 py-20 sm:py-28"
        >
          <div className={SHELL}>
            <SectionHead
              id="pricing-title"
              eyebrow={t.pricing.eyebrow}
              title={t.pricing.title}
              lead={t.pricing.lead}
              center
            />
            <div className="mx-auto mt-12 grid max-w-5xl overflow-hidden rounded-[1.75rem] border border-line bg-surface shadow-[0_30px_80px_-30px_rgb(4_38_109/0.3)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="midnight relative isolate flex flex-col gap-5 overflow-hidden p-8 text-white sm:p-10">
                <BrandMark className="pointer-events-none absolute -right-24 -bottom-28 -z-10 w-[22rem] opacity-25" />
                <p className="text-caption font-semibold tracking-[0.14em] text-cyan-200 uppercase">
                  {t.pricing.plan}
                </p>
                <p className="flex items-end gap-3">
                  <s className="pb-2 font-display text-lead text-white/70">{t.pricing.was}</s>
                  <span className="tabular font-display text-[3.5rem] leading-none font-semibold">
                    {t.pricing.price}
                  </span>
                </p>
                <p className="text-body text-white/80">{t.pricing.per}</p>
                <p className="rounded-xl bg-white/10 px-4 py-3 text-body text-white/90 ring-1 ring-white/15">
                  {t.pricing.setup}
                </p>
                <div className="mt-auto flex flex-col gap-3 pt-4">
                  <PrimaryLink href="/signup" dark>
                    {t.pricing.start}
                  </PrimaryLink>
                  <a
                    href={DEMO}
                    className={cx(
                      'text-center text-body font-semibold text-white underline-offset-4 hover:underline',
                      FOCUS_DARK,
                    )}
                  >
                    {t.pricing.demo}
                  </a>
                </div>
              </div>
              <ul className="flex flex-col justify-center gap-4 p-8 sm:p-10">
                {t.pricing.includes.map((x) => (
                  <li key={x} className="flex items-start gap-3 text-lead text-ink">
                    <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-signal-go-tint">
                      <Check aria-hidden className="size-3.5 text-signal-go-ink" />
                    </span>
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section aria-labelledby="cta-title" className="pb-20 sm:pb-28">
          <div className={SHELL}>
            <div className="midnight relative isolate overflow-hidden rounded-[1.75rem] px-6 py-16 text-center text-white sm:px-12 sm:py-20">
              <span
                aria-hidden
                className="absolute -top-32 left-1/2 -z-10 aspect-square w-[40rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(10_197_255/0.25),transparent_60%)]"
              />
              <BrandMark className="pointer-events-none absolute -right-40 -bottom-48 -z-10 w-[34rem] opacity-30" />
              <h2
                id="cta-title"
                className="mx-auto max-w-[20ch] font-display text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-[3rem]"
              >
                {t.cta.title}
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lead text-white/75">{t.cta.lead}</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <PrimaryLink href="/signup" dark>
                  {t.cta.start}
                </PrimaryLink>
                <SecondaryLink href={DEMO} dark>
                  {t.cta.demo}
                </SecondaryLink>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
