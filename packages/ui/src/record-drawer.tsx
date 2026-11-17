'use client';

import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

/** Opens a record from any name without leaving the work underneath. Focus returns on close. */
export function RecordDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  closeLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-[var(--shadow-overlay)] outline-none">
          <header className="flex items-start gap-4 border-b border-line px-6 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lead font-semibold text-ink">{title}</Dialog.Title>
              {subtitle ? (
                <Dialog.Description className="text-caption text-ink-muted">
                  {subtitle}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label={closeLabel}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-navy-50 hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </Dialog.Close>
          </header>
          {/* Focusable so keyboard users can scroll a long record. */}
          <div
            tabIndex={0}
            role="region"
            aria-label={title}
            className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
          >
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
