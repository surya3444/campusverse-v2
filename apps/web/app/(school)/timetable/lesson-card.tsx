'use client';

// A lesson in a timetable grid, as the hub draws it: a card in the subject's colour with a bar on
// the left, the subject's name, and the teacher or class with the room underneath. Colours are
// handed out over the subjects on screen in a fixed order, so a section's subjects never share
// one (a hash would collide). The palette is the design system's tint and ink pairs.
import { cx } from '@campusverse/ui';
import type { ReactNode } from 'react';

export const PALETTE = [
  { cell: 'bg-sky-tint text-sky-ink', bar: 'bg-sky-ink' },
  { cell: 'bg-violet-tint text-violet-ink', bar: 'bg-violet-ink' },
  { cell: 'bg-teal-tint text-teal-ink', bar: 'bg-teal-ink' },
  { cell: 'bg-amber-tint text-amber-ink', bar: 'bg-amber-ink' },
  { cell: 'bg-rose-tint text-rose-ink', bar: 'bg-rose-ink' },
  { cell: 'bg-signal-go-tint text-signal-go-ink', bar: 'bg-signal-go-ink' },
  { cell: 'bg-navy-50 text-navy-950', bar: 'bg-navy-950' },
] as const;
export type SubjectColor = (typeof PALETTE)[number];

/** One colour per subject on screen, the same for the same set of subjects. */
export function subjectColors(keys: Iterable<string>): (key: string) => SubjectColor {
  const sorted = [...new Set(keys)].sort();
  const at = new Map(sorted.map((k, i) => [k, PALETTE[i % PALETTE.length] ?? PALETTE[0]]));
  return (key) => at.get(key) ?? PALETTE[0];
}

export function LessonCard({
  subject,
  sub,
  color,
  tag,
  muted = false,
  dashed = false,
  className,
}: {
  subject: string;
  /** Teacher or class, and room. */
  sub?: string | null;
  color: SubjectColor;
  /** A short badge after the subject: "Cover", "New". */
  tag?: ReactNode;
  /** A lesson that isn't happening as planned (covered by someone else). */
  muted?: boolean;
  /** A lesson that isn't the person's own (a cover they take). */
  dashed?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'relative flex w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-lg py-1.5 pr-2 pl-3 text-left',
        // Not happening as planned: neutral, so it never competes with the lessons that are.
        muted ? 'bg-paper text-ink-muted' : color.cell,
        dashed && 'outline-2 outline-offset-[-2px] outline-current outline-dashed',
        className,
      )}
    >
      <span
        aria-hidden
        className={cx('absolute inset-y-0 left-0 w-1', muted ? 'bg-line-strong' : color.bar)}
      />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={cx('truncate text-body font-semibold', muted && 'line-through')}>
          {subject}
        </span>
        {tag}
      </span>
      {sub && <span className="truncate text-caption">{sub}</span>}
    </span>
  );
}
