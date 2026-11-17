'use client';

import { Command } from 'cmdk';
import { ArrowRight, Search, Sparkles, Zap } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cx } from './primitives';

export type CommandItem = {
  id: string;
  group: 'find' | 'do';
  label: string;
  hint?: string;
  keywords?: string[];
  onSelect: () => void;
};

export type CommandLabels = {
  name: string;
  trigger: string;
  placeholder: string;
  find: string;
  do: string;
  ask: string;
  askPrompt: (query: string) => string;
  aiBadge: string;
  empty: string;
  shortcut: string;
};

const GROUP_HEADING =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-muted';
const ITEM =
  'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-body text-ink data-[selected=true]:bg-navy-50 data-[selected=true]:text-navy-950';

/** The header search field that opens the palette. On phones it collapses to an icon. */
export function CommandTrigger({ onOpen, labels }: { onOpen: () => void; labels: CommandLabels }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-10 items-center gap-2.5 rounded-xl bg-navy-50/60 px-3.5 text-body text-ink-muted transition-colors hover:bg-navy-50 sm:w-full sm:max-w-[400px]"
    >
      <Search aria-hidden className="size-4 shrink-0" />
      {/* The visible text is the accessible name; on phones it is kept for screen readers only. */}
      <span className="sr-only flex-1 truncate text-left sm:not-sr-only">{labels.placeholder}</span>
      <kbd className="hidden shrink-0 rounded-md border border-line bg-surface px-1.5 py-0.5 font-sans text-[11px] text-ink-muted sm:inline">
        {labels.shortcut}
      </kbd>
    </button>
  );
}

/**
 * Find a record, do an action, or ask Verse AI, from anywhere. Ctrl K (⌘K on Mac) toggles it.
 * Verse AI's answers stay inside the palette and are always labelled as AI.
 */
export function CommandPalette({
  open,
  onOpenChange,
  items,
  onAsk,
  onQueryChange,
  answer,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  onAsk: (query: string) => void;
  /** Called as the person types, for searching records on the server. */
  onQueryChange?: (query: string) => void;
  answer?: ReactNode;
  labels: CommandLabels;
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const choose = (fn: () => void) => {
    onOpenChange(false);
    setQuery('');
    fn();
  };

  const groups = [
    { key: 'find' as const, heading: labels.find, Icon: Search },
    { key: 'do' as const, heading: labels.do, Icon: Zap },
  ];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={labels.name}
      loop
      overlayClassName="fixed inset-0 z-50 bg-ink/30"
      contentClassName="fixed inset-x-3 top-[10vh] z-50 mx-auto max-w-xl overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-overlay)] sm:inset-x-6"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search aria-hidden className="size-4 shrink-0 text-ink-muted" />
        <Command.Input
          value={query}
          onValueChange={(q) => {
            setQuery(q);
            onQueryChange?.(q);
          }}
          placeholder={labels.placeholder}
          className="h-12 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
        />
        <kbd className="shrink-0 rounded border border-line px-1.5 text-caption text-ink-muted">
          Esc
        </kbd>
      </div>

      {answer && !query && (
        <div className="flex gap-3 border-b border-line bg-navy-50 px-4 py-3">
          <span className="h-fit shrink-0 rounded bg-midnight-950 px-1.5 py-0.5 text-caption font-semibold text-cyan-400">
            {labels.aiBadge}
          </span>
          <div className="text-body text-ink">{answer}</div>
        </div>
      )}

      <Command.List className="max-h-[50vh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-body text-ink-muted">
          {labels.empty}
        </Command.Empty>
        {groups.map(({ key, heading, Icon }) => (
          <Command.Group key={key} heading={heading} className={GROUP_HEADING}>
            {items
              .filter((i) => i.group === key)
              .map((item) => (
                <Command.Item
                  key={item.id}
                  value={`${item.label} ${item.id}`}
                  keywords={item.keywords ?? []}
                  onSelect={() => choose(item.onSelect)}
                  className={ITEM}
                >
                  <Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && (
                    <span className="shrink-0 text-caption text-ink-muted">{item.hint}</span>
                  )}
                </Command.Item>
              ))}
          </Command.Group>
        ))}
        {query.trim() && (
          <Command.Group heading={labels.ask} forceMount className={GROUP_HEADING}>
            <Command.Item
              forceMount
              value={`ask ${query}`}
              onSelect={() => {
                onAsk(query.trim());
                setQuery('');
              }}
              className={cx(ITEM)}
            >
              <Sparkles aria-hidden className="size-4 shrink-0 text-navy-700" />
              <span className="min-w-0 flex-1 truncate">{labels.askPrompt(query.trim())}</span>
              <ArrowRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
            </Command.Item>
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
