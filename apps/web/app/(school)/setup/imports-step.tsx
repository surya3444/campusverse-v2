'use client';

import { Announcer, Button, PreviewCanvas, cx } from '@campusverse/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, History as HistoryIcon, Loader2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { ErrorNote, keys, useRefreshSetup, type ImportPreview, type SetupOverview } from './shared';

const t = en.setup.imports;
type Kind = 'students' | 'staff';
type Batch = { id: string; status: string; failure: string | null; valid: number };

const STATUS_CHIP: Record<string, string> = {
  valid: 'bg-signal-go-tint text-signal-go-ink',
  invalid: 'bg-signal-stop-tint text-signal-stop-ink',
  duplicate: 'bg-signal-warn-tint text-signal-warn-ink',
  committed: 'bg-signal-go-tint text-signal-go-ink',
  committing: 'bg-navy-50 text-navy-700',
  failed: 'bg-signal-stop-tint text-signal-stop-ink',
  undone: 'bg-navy-50 text-ink-muted',
  previewed: 'bg-navy-50 text-ink-muted',
};
const BATCH_STATUS: Record<string, string> = {
  committed: t.imported,
  committing: t.importing,
  failed: t.failed,
  undone: t.undone,
  previewed: t.checking,
};

export function ImportsStep({
  institutionId,
  overview,
  allowV1 = false,
  kinds = ['staff', 'students'],
}: {
  institutionId: string;
  overview: SetupOverview;
  allowV1?: boolean;
  /** Colleges import staff here; their students are enrolled into a batch. */
  kinds?: readonly Kind[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-6">
      {kinds.map((kind) => (
        <ImportPanel
          key={kind}
          kind={kind}
          institutionId={institutionId}
          onDone={setMessage}
          allowV1={allowV1}
        />
      ))}
      <History institutionId={institutionId} imports={overview.imports} onDone={setMessage} />
      <Announcer message={message} />
    </div>
  );
}

function ImportPanel({
  kind,
  institutionId,
  onDone,
  allowV1,
}: {
  kind: Kind;
  institutionId: string;
  onDone: (m: string) => void;
  /** Offer the Campusverse V1 importer (the Data Import centre). */
  allowV1: boolean;
}) {
  const refresh = useRefreshSetup(institutionId);
  const fileInput = useRef<HTMLInputElement>(null);
  const v1Input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const title = kind === 'students' ? t.students : t.staff;

  const refreshed = useRef(false);
  const upload = useMutation({
    mutationFn: ({ file, v1 }: { file: File; v1: boolean }) =>
      api.upload<ImportPreview>(
        `/school/setup/${institutionId}/imports/${kind}${v1 ? '?source=v1' : ''}`,
        file,
      ),
    onSuccess: setPreview,
  });
  const commit = useMutation({
    mutationFn: (batchId: string) => api.post(`/school/setup/imports/${batchId}/commit`),
    onSuccess: (_, batchId) => {
      setConfirming(false);
      setPreview(null);
      refreshed.current = false;
      setPending(batchId);
      onDone(t.done);
    },
  });
  // The worker applies the batch; poll until it is done.
  const batch = useQuery({
    queryKey: keys.batch(pending ?? ''),
    queryFn: () => api.get<Batch>(`/school/setup/imports/${pending}`),
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data?.status === 'committing' || !q.state.data ? 1000 : false),
  });
  const finished = batch.data && batch.data.status !== 'committing';
  // Refresh the summaries once, when the batch settles.
  useEffect(() => {
    if (finished && !refreshed.current) {
      refreshed.current = true;
      void refresh();
    }
  }, [finished, refresh]);

  const flagged = preview?.flagged ?? [];
  return (
    <section className="panel" aria-labelledby={`import-${kind}`}>
      <header className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-navy-50 text-navy-700">
          <FileSpreadsheet aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`import-${kind}`} className="text-body font-semibold text-ink">
            {title}
          </h2>
          <p className="text-caption text-ink-muted">
            {kind === 'students' ? t.studentsHelp : t.staffHelp}
          </p>
        </div>
        <a
          href={`/api/v1/school/setup/templates/${kind}`}
          className="inline-flex h-8 items-center gap-2 rounded-md px-3 text-caption font-medium text-navy-950 hover:bg-navy-50"
        >
          <Download aria-hidden className="size-3.5" />
          {t.template}
        </a>
      </header>

      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label={`${t.choose}: ${title}`}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate({ file, v1: false });
              e.target.value = '';
            }}
          />
          {allowV1 && (
            <input
              ref={v1Input}
              type="file"
              accept=".json,.jsonl,application/json"
              aria-label={`${t.chooseV1}: ${title}`}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate({ file, v1: true });
                e.target.value = '';
              }}
            />
          )}
          <Button
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Upload aria-hidden className="size-4" />
            )}
            {upload.isPending ? t.checking : t.choose}
          </Button>
          {allowV1 && (
            <Button
              variant="quiet"
              onClick={() => v1Input.current?.click()}
              disabled={upload.isPending}
              title={t.v1Hint}
            >
              <HistoryIcon aria-hidden className="size-4" />
              {t.chooseV1}
            </Button>
          )}
          {pending && batch.data && (
            <span
              role="status"
              className={cx(
                'rounded-full px-2.5 py-0.5 text-caption font-medium',
                STATUS_CHIP[batch.data.status],
              )}
            >
              {BATCH_STATUS[batch.data.status]}
              {batch.data.failure
                ? ` · ${en.setup.errors[batch.data.failure] ?? batch.data.failure}`
                : ''}
            </span>
          )}
        </div>
        <ErrorNote error={upload.error ?? commit.error} />

        {preview && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2 text-caption">
              <span className={cx('rounded-full px-2.5 py-0.5 font-medium', STATUS_CHIP.valid)}>
                {t.valid(preview.counts.valid)}
              </span>
              {preview.counts.invalid > 0 && (
                <span className={cx('rounded-full px-2.5 py-0.5 font-medium', STATUS_CHIP.invalid)}>
                  {t.invalid(preview.counts.invalid)}
                </span>
              )}
              {preview.counts.duplicate > 0 && (
                <span
                  className={cx('rounded-full px-2.5 py-0.5 font-medium', STATUS_CHIP.duplicate)}
                >
                  {t.duplicate(preview.counts.duplicate)}
                </span>
              )}
              {preview.skipped > 0 && (
                <span className="rounded-full bg-paper px-2.5 py-0.5 font-medium text-ink-muted">
                  {t.v1Skipped(preview.skipped)}
                </span>
              )}
              {preview.counts.warnings > 0 && (
                <span className="rounded-full bg-navy-50 px-2.5 py-0.5 font-medium text-navy-700">
                  {t.warnings(preview.counts.warnings)}
                </span>
              )}
            </div>
            {preview.ignoredColumns.length > 0 && (
              <p className="text-caption text-ink-muted">
                {t.ignored(preview.ignoredColumns.join(', '))}
              </p>
            )}

            {flagged.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full min-w-[520px] text-body">
                  <caption className="border-b border-line bg-paper px-4 py-2 text-left text-caption font-medium text-ink">
                    {t.flagged}
                  </caption>
                  <thead>
                    <tr className="border-b border-line text-left text-caption text-ink-muted">
                      <th scope="col" className="px-4 py-2 font-medium">
                        {t.row}
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        {en.setup.fields.name}
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        {t.problem}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {flagged.slice(0, 50).map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="tabular px-4 py-2 align-top text-ink-muted">
                          {r.rowNumber}
                        </td>
                        <td className="px-4 py-2 align-top text-ink">
                          {r.raw.name || '—'}
                          <span
                            className={cx(
                              'ml-2 rounded-full px-2 py-0.5 text-caption',
                              STATUS_CHIP[r.status],
                            )}
                          >
                            {t.status[r.status]}
                          </span>
                        </td>
                        <td className="px-4 py-2 align-top text-caption text-ink">
                          <ul className="flex flex-col gap-0.5">
                            {r.problems.map((p, i) => (
                              <li
                                key={i}
                                className={
                                  p.severity === 'error' ? 'text-signal-stop-ink' : 'text-ink-muted'
                                }
                              >
                                {en.setup.fields[p.field] ?? p.field}:{' '}
                                {en.setup.problems[p.code] ?? p.code}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {flagged.length > 50 && (
                  <p className="px-4 py-2 text-caption text-ink-muted">
                    {t.more(flagged.length - 50)}
                  </p>
                )}
              </div>
            )}

            {preview.counts.valid > 0 && (
              <Button className="self-start" onClick={() => setConfirming(true)}>
                {t.commit(preview.counts.valid)}
              </Button>
            )}
          </div>
        )}
      </div>

      {preview && confirming && (
        <PreviewCanvas
          open
          onOpenChange={setConfirming}
          title={t.canvasTitle(title)}
          actionLabel={t.commit(preview.counts.valid)}
          changes={[
            t.change(preview.counts.valid, title),
            ...Object.entries(preview.landing).map(([where, n]) =>
              t.landing(t.roleLabels[where] ?? where, n),
            ),
          ]}
          affected={Object.entries(preview.landing).map(([where, count]) => ({
            label: t.roleLabels[where] ?? where,
            count,
          }))}
          risks={
            preview.counts.invalid + preview.counts.duplicate > 0
              ? [t.skipped(preview.counts.invalid + preview.counts.duplicate)]
              : []
          }
          undo={t.undoNote}
          busy={commit.isPending}
          onConfirm={() => commit.mutate(preview.batchId)}
          labels={en.preview}
        />
      )}
    </section>
  );
}

function History({
  institutionId,
  imports,
  onDone,
}: {
  institutionId: string;
  imports: SetupOverview['imports'];
  onDone: (m: string) => void;
}) {
  const refresh = useRefreshSetup(institutionId);
  const [undoing, setUndoing] = useState<SetupOverview['imports'][number] | null>(null);
  const undo = useMutation({
    mutationFn: (id: string) => api.post(`/school/setup/imports/${id}/undo`),
    onSuccess: async () => {
      setUndoing(null);
      onDone(t.undoneDone);
      await refresh();
    },
  });
  const shown = imports.filter((i) => i.status !== 'previewed');
  if (shown.length === 0) return null;

  return (
    <section className="panel" aria-labelledby="import-history">
      <h2
        id="import-history"
        className="border-b border-line px-5 py-3.5 text-body font-semibold text-ink"
      >
        {t.history}
      </h2>
      <ul className="divide-y divide-line">
        {shown.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body text-ink">{i.fileName}</span>
              <span className="tabular text-caption text-ink-muted">
                {i.kind === 'students' ? t.students : t.staff} · {t.rows(i.valid)}
                {i.source === 'v1' ? ` · ${t.fromV1}` : ''}
              </span>
            </span>
            <span
              className={cx(
                'rounded-full px-2.5 py-0.5 text-caption font-medium',
                STATUS_CHIP[i.status],
              )}
            >
              {BATCH_STATUS[i.status]}
            </span>
            {i.status === 'committed' && (
              <Button variant="quiet" size="sm" onClick={() => setUndoing(i)}>
                {t.undo}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {undo.error && (
        <div className="px-5 pb-4">
          <ErrorNote error={undo.error} />
        </div>
      )}
      {undoing && (
        <PreviewCanvas
          open
          onOpenChange={(o) => !o && setUndoing(null)}
          title={t.undoTitle}
          actionLabel={t.undo}
          changes={[t.undoChange(undoing.fileName)]}
          affected={[
            { label: undoing.kind === 'students' ? t.students : t.staff, count: undoing.valid },
          ]}
          risks={[t.undoRisk]}
          undo={t.undoUndo}
          busy={undo.isPending}
          onConfirm={() => undo.mutate(undoing.id)}
          labels={en.preview}
        />
      )}
    </section>
  );
}
