'use client';

import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { Button } from './primitives';

export type PreviewLabels = {
  changes: string;
  affected: string;
  risks: string;
  noRisks: string;
  undo: string;
  cancel: string;
  close: string;
};

/**
 * The one screen every bulk action passes through: what will change, who is affected, what
 * could go wrong and how to undo it. The confirm button repeats the action's exact name.
 */
export function PreviewCanvas({
  open,
  onOpenChange,
  title,
  actionLabel,
  changes,
  affected,
  risks,
  undo,
  busy = false,
  onConfirm,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The same words as the button that opened this, such as "Remind 4 teachers". */
  actionLabel: string;
  changes: string[];
  affected: { label: string; count: number }[];
  risks: string[];
  undo: string;
  busy?: boolean;
  onConfirm: () => void;
  labels: PreviewLabels;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col bg-paper outline-none sm:inset-6 sm:rounded-lg sm:border sm:border-line sm:shadow-[var(--shadow-overlay)] lg:inset-x-[12%]">
          <header className="flex items-center gap-4 border-b border-line bg-surface px-5 py-4 sm:rounded-t-lg sm:px-8">
            <Dialog.Title className="min-w-0 flex-1 text-lead font-semibold text-ink">
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label={labels.close}
              className="flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-navy-50 hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">{actionLabel}</Dialog.Description>

          {/* Focusable so keyboard users can scroll it on small screens. */}
          <div
            tabIndex={0}
            role="region"
            aria-label={title}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div className="grid gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[1.4fr_1fr]">
              <section aria-labelledby="pc-changes" className="panel h-fit">
                <h3
                  id="pc-changes"
                  className="border-b border-line px-5 py-3.5 text-body font-semibold text-ink"
                >
                  {labels.changes}
                </h3>
                <ol className="divide-y divide-line">
                  {changes.map((c, i) => (
                    <li key={i} className="flex gap-4 px-5 py-3 text-body text-ink">
                      <span className="tabular w-5 shrink-0 text-ink-muted">{i + 1}</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <div className="flex flex-col gap-6">
                <section aria-labelledby="pc-affected" className="panel">
                  <h3
                    id="pc-affected"
                    className="border-b border-line px-5 py-3.5 text-body font-semibold text-ink"
                  >
                    {labels.affected}
                  </h3>
                  <dl className="divide-y divide-line">
                    {affected.map((a) => (
                      <div
                        key={a.label}
                        className="flex items-baseline justify-between gap-4 px-5 py-3"
                      >
                        <dt className="text-body text-ink-muted">{a.label}</dt>
                        <dd className="tabular text-lead font-semibold text-ink">{a.count}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section aria-labelledby="pc-risks" className="panel">
                  <h3
                    id="pc-risks"
                    className="border-b border-line px-5 py-3.5 text-body font-semibold text-ink"
                  >
                    {labels.risks}
                  </h3>
                  {risks.length === 0 ? (
                    <p className="px-5 py-3 text-body text-ink-muted">{labels.noRisks}</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {risks.map((r, i) => (
                        <li key={i} className="flex gap-3 px-5 py-3 text-body text-ink">
                          <AlertTriangle
                            aria-hidden
                            className="mt-0.5 size-4 shrink-0 text-signal-warn"
                          />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section aria-labelledby="pc-undo" className="panel px-5 py-4">
                  <h3 id="pc-undo" className="mb-1.5 text-body font-semibold text-ink">
                    {labels.undo}
                  </h3>
                  <p className="flex gap-3 text-body text-ink-muted">
                    <RotateCcw aria-hidden className="mt-1 size-4 shrink-0" />
                    {undo}
                  </p>
                </section>
              </div>
            </div>
          </div>

          <footer className="flex flex-col-reverse gap-3 border-t border-line bg-surface px-5 py-4 sm:flex-row sm:justify-end sm:rounded-b-lg sm:px-8">
            <Dialog.Close asChild>
              <Button variant="secondary" size="lg">
                {labels.cancel}
              </Button>
            </Dialog.Close>
            <Button size="lg" onClick={onConfirm} disabled={busy}>
              {actionLabel}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
