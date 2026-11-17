'use client';

import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { FormEvent, ReactNode } from 'react';
import { Button, cx } from './primitives';

const WIDTH = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' } as const;

/**
 * Every create and edit form opens here, over the page, never pushed in between the content.
 * Focus moves in and returns on close; Esc and the close button cancel; the body scrolls while the
 * title and the actions stay put. Render it only while open (it opens on mount).
 */
export function FormModal({
  title,
  description,
  submitLabel,
  cancelLabel,
  pending = false,
  submitDisabled = false,
  error,
  size = 'md',
  tone = 'primary',
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description?: ReactNode;
  submitLabel: string;
  cancelLabel: string;
  pending?: boolean;
  submitDisabled?: boolean;
  /** Shown above the actions, announced to screen readers. */
  error?: string | null | undefined;
  size?: keyof typeof WIDTH;
  tone?: 'primary' | 'danger';
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pending) onSubmit();
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-midnight-950/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cx(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-2xl border border-line bg-surface shadow-[var(--shadow-overlay)] outline-none',
            WIDTH[size],
          )}
        >
          <form onSubmit={submit} aria-label={title} className="flex min-h-0 flex-1 flex-col">
            <header className="flex items-start gap-3 border-b border-line px-6 py-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="font-display text-lead font-semibold text-ink">
                  {title}
                </Dialog.Title>
                {description ? (
                  <Dialog.Description className="mt-0.5 text-caption text-ink-muted">
                    {description}
                  </Dialog.Description>
                ) : (
                  <Dialog.Description className="sr-only">{title}</Dialog.Description>
                )}
              </div>
              <Dialog.Close
                aria-label={cancelLabel}
                disabled={pending}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-navy-50 hover:text-ink"
              >
                <X aria-hidden className="size-4" />
              </Dialog.Close>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-2">{children}</div>
            </div>
            <footer className="flex flex-col gap-3 border-t border-line bg-paper/60 px-6 py-4">
              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-signal-stop-tint px-3 py-2 text-caption text-signal-stop-ink"
                >
                  {error}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="quiet" onClick={onClose} disabled={pending}>
                  {cancelLabel}
                </Button>
                <Button
                  type="submit"
                  variant={tone === 'danger' ? 'danger' : 'primary'}
                  disabled={pending || submitDisabled}
                  aria-busy={pending}
                >
                  {submitLabel}
                </Button>
              </div>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A labelled field for FormModal. `wide` spans both columns. */
export function ModalField({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string;
  hint?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cx('flex flex-col gap-1.5', wide && 'sm:col-span-2')}>
      <span className="text-caption font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-caption text-ink-muted">{hint}</span>}
    </label>
  );
}
