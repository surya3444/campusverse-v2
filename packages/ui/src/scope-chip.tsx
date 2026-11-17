'use client';

import { Check, ChevronsUpDown, Building2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';

export type ScopeOption = { id: string; campus: string; institution: string; year: string };

/** Always shows where you are working: institution, campus and academic year, with a switcher. */
export function ScopeChip({
  value,
  options,
  onChange,
  label,
  dark = false,
}: {
  value: ScopeOption;
  options: ScopeOption[];
  onChange: (id: string) => void;
  /** Accessible name prefix, such as "Working in". */
  label: string;
  /** On the midnight sidebar. */
  dark?: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={
          dark
            ? 'flex w-full min-w-0 items-center gap-3 rounded-xl bg-white/5 p-2.5 text-left transition-colors hover:bg-white/10'
            : 'flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left hover:border-line-strong'
        }
      >
        {/* The visible text stays the start of the accessible name (WCAG 2.5.3). */}
        <span className="sr-only">{label}:</span>
        {dark && (
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#0b4ea2,#1a6fd0)] text-cyan-200"
          >
            <Building2 className="size-4" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`truncate text-body font-medium ${dark ? 'text-white' : 'text-ink'}`}>
            {value.institution}
          </span>
          {/* Second line only when it adds something (a group's campus, or the year). */}
          {(value.year || value.campus !== value.institution) && (
            <span
              className={`tabular truncate text-caption ${dark ? 'text-white/65' : 'text-ink-muted'}`}
            >
              {value.year ? `${value.campus} · ${value.year}` : value.campus}
            </span>
          )}
        </span>
        <ChevronsUpDown
          aria-hidden
          className={`size-4 shrink-0 ${dark ? 'text-white/60' : 'text-ink-faint'}`}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-72 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-overlay)]"
        >
          <DropdownMenu.Label className="px-3 py-2 text-caption font-medium text-ink-muted">
            {label}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value.id} onValueChange={onChange}>
            {options.map((o) => (
              <DropdownMenu.RadioItem
                key={o.id}
                value={o.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-body text-ink outline-none data-[highlighted]:bg-navy-50"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{o.institution}</span>
                  <span className="tabular text-caption text-ink-muted">
                    {o.year ? `${o.campus} · ${o.year}` : o.campus}
                  </span>
                </span>
                <span className="flex size-4 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check aria-hidden className="size-4 text-navy-950" />
                  </DropdownMenu.ItemIndicator>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
