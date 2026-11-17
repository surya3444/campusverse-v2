'use client';

import { Button } from '@campusverse/ui';
import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState, type FormEvent, type ReactNode } from 'react';

/** Asks for a reason before an audited action; the action stays disabled until one is given. */
export function ReasonDialog({
  title,
  hint,
  label,
  action,
  cancel,
  minLength = 5,
  errorText,
  onClose,
  submit,
  children,
}: {
  title: string;
  hint: string;
  label: string;
  action: string;
  cancel: string;
  minLength?: number;
  errorText: (e: unknown) => string;
  onClose: () => void;
  submit: (reason: string) => Promise<void>;
  /** Extra fields above the reason, such as the new status of a correction. */
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submit(reason.trim());
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <Dialog.Content className="fixed top-[20vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-line bg-surface shadow-[var(--shadow-overlay)] outline-none">
          <form onSubmit={(e) => void onSubmit(e)}>
            <header className="flex items-center gap-3 border-b border-line px-5 py-4">
              <Dialog.Title className="flex-1 text-body font-semibold text-ink">
                {title}
              </Dialog.Title>
              <Dialog.Close
                aria-label={cancel}
                className="flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-paper"
              >
                <X aria-hidden className="size-4" />
              </Dialog.Close>
            </header>
            <div className="flex flex-col gap-3 px-5 py-4">
              <Dialog.Description className="text-caption text-ink-muted">
                {hint}
              </Dialog.Description>
              {children}
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-ink">{label}</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  required
                  minLength={minLength}
                  className="rounded-md border border-line-strong bg-surface px-3 py-2 text-body text-ink outline-none focus:border-navy-950"
                />
              </label>
              {error && (
                <p
                  role="alert"
                  className="rounded-md bg-signal-stop-tint px-3 py-2 text-caption text-signal-stop-ink"
                >
                  {error}
                </p>
              )}
            </div>
            <footer className="flex justify-end gap-3 border-t border-line px-5 py-3">
              <Dialog.Close asChild>
                <Button variant="secondary">{cancel}</Button>
              </Dialog.Close>
              <Button type="submit" disabled={busy || reason.trim().length < minLength}>
                {action}
              </Button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
