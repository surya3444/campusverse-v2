'use client';

import type { ImportPreview, ImportRow } from '@campusverse/school-admissions';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  PageHeader,
  Pill,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, RotateCcw, Upload, UploadCloud } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { YearPicker, admissionError, c, field, t, useCounsellors, useYear, when } from '../shared';

/** The template's columns (school/admissions TEMPLATE_HEADERS; web takes only types from modules). */
const TEMPLATE = [
  'Child name',
  'Date of birth',
  'Gender',
  'Class',
  'Guardian name',
  'Relationship',
  'Mobile',
  'Email',
  'Previous school',
  'Notes',
];
const SAMPLE = [
  'Aarav Sharma',
  '15/06/2020',
  'Boy',
  'Class 1',
  'Priya Sharma',
  'Mother',
  '9876543210',
  'priya@example.com',
  'Little Steps Play School',
  'Met at the open day',
];

function downloadTemplate() {
  const csv = `${TEMPLATE.join(',')}\n${SAMPLE.map((v) => (v.includes(',') ? `"${v}"` : v)).join(',')}\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'campusverse-leads-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** Leads from a sheet: checked row by row (duplicates and problems) before anything is added. */
export function ImportView() {
  const qc = useQueryClient();
  const school = useInstitution();
  const id = school.institutionId;
  const [year, setYear] = useYear();
  const counsellors = useCounsellors(id);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [opts, setOpts] = useState({ source: 'other', campaign: '', ownerPersonId: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<ImportRow | null>(null);
  const history = useQuery({
    queryKey: ['admission-imports', id],
    queryFn: () => api.get<ImportRow[]>(`/school/admissions/${id}/imports`),
    enabled: !!id,
  });
  const preview = useMutation({
    mutationFn: (f: File) =>
      api.upload<ImportPreview>(`/school/admissions/${id}/imports/preview`, f, { yearLabel: year }),
  });
  const commit = useMutation({
    mutationFn: (f: File) =>
      api.upload<{ batchId: string; imported: number; skipped: number }>(
        `/school/admissions/${id}/imports`,
        f,
        { yearLabel: year, ...opts },
      ),
    onSuccess: (r) => {
      setMessage(c.imports.done(r.imported, r.skipped));
      setFile(null);
      preview.reset();
      void qc.invalidateQueries({ queryKey: ['admission-imports'] });
      void qc.invalidateQueries({ queryKey: ['admissions'] });
    },
  });
  const undo = useMutation({
    mutationFn: (batchId: string) =>
      api.post<{ closed: number; kept: number }>(`/school/admissions/imports/${batchId}/undo`),
    onSuccess: (r) => {
      setUndoing(null);
      setMessage(c.imports.undone(r.closed, r.kept));
      void qc.invalidateQueries({ queryKey: ['admission-imports'] });
      void qc.invalidateQueries({ queryKey: ['admissions'] });
    },
  });
  const choose = (f: File | undefined) => {
    if (!f || !id) return;
    setFile(f);
    commit.reset();
    preview.mutate(f);
  };
  if (history.isError && history.error instanceof ApiFailure && history.error.status === 403)
    return <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />;
  const p = preview.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Upload}
        eyebrow={en.systems.groups.enrollment}
        title={c.imports.title}
        description={c.imports.lead}
        actions={
          <Button variant="secondary" onClick={downloadTemplate}>
            <Download aria-hidden className="size-4" />
            {c.imports.template}
          </Button>
        }
      >
        <YearPicker year={year} onChange={setYear} />
      </PageHeader>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="upload" className="panel flex flex-col gap-5 p-5">
          <div>
            <h2 id="upload" className="font-display text-lead font-semibold text-ink">
              {c.imports.step1}
            </h2>
            <p className="text-body text-ink-muted">{c.imports.step1Lead}</p>
          </div>
          <button
            type="button"
            disabled={!id}
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              choose(e.dataTransfer.files[0]);
            }}
            className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line-strong bg-paper/60 px-6 py-10 text-center transition-colors hover:border-navy-950 hover:bg-navy-50/50"
          >
            <UploadCloud aria-hidden className="size-8 text-navy-950" />
            <span className="font-medium text-ink">{file ? file.name : c.imports.drop}</span>
            <span className="text-caption text-ink-muted">{c.imports.dropHint}</span>
          </button>
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => choose(e.target.files?.[0])}
          />
          {preview.isPending && <p className="text-body text-ink-muted">{c.imports.checking}</p>}
          {preview.error && (
            <p
              role="alert"
              className="rounded-md bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink"
            >
              {admissionError(preview.error)}
            </p>
          )}
          {p && (
            <>
              <KeyFigures
                variant="strip"
                label={c.imports.check}
                figures={[
                  { label: c.imports.rows, value: String(p.total) },
                  { label: c.imports.ready, value: String(p.ready), tone: 'go', valueTone: 'navy' },
                  {
                    label: c.imports.duplicates,
                    value: String(p.rows.filter((r) => r.status === 'duplicate').length),
                  },
                  {
                    label: c.imports.problems,
                    value: String(p.rows.filter((r) => r.status === 'problem').length),
                    tone: 'warn',
                  },
                ]}
              />
              {p.missingColumns.length > 0 && (
                <p
                  role="alert"
                  className="rounded-md bg-signal-warn-tint px-3 py-2 text-body text-signal-warn-ink"
                >
                  {c.imports.missing(
                    p.missingColumns.map((k) => c.imports.columns[k] ?? k).join(', '),
                  )}
                </p>
              )}
              <div className="max-h-[420px] overflow-auto rounded-xl border border-line">
                <table className="w-full text-body">
                  <caption className="sr-only">{c.imports.check}</caption>
                  <thead className="sticky top-0 bg-paper">
                    <tr className="text-left text-caption font-medium text-ink-muted">
                      <th scope="col" className="px-3 py-2.5">
                        {c.imports.row}
                      </th>
                      <th scope="col" className="px-3 py-2.5">
                        {t.childName}
                      </th>
                      <th scope="col" className="px-3 py-2.5">
                        {t.className}
                      </th>
                      <th scope="col" className="px-3 py-2.5">
                        {t.guardian}
                      </th>
                      <th scope="col" className="px-3 py-2.5">
                        {c.imports.status}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {p.rows.map((r) => (
                      <tr key={r.row} className={cx(r.status !== 'ready' && 'bg-paper/50')}>
                        <td className="tabular px-3 py-2 text-caption text-ink-muted">{r.row}</td>
                        <td className="px-3 py-2 text-ink">{r.childName || '—'}</td>
                        <td className="px-3 py-2 text-ink">{r.className || '—'}</td>
                        <td className="px-3 py-2">
                          <span className="flex flex-col">
                            <span className="text-ink">{r.guardianName || '—'}</span>
                            <span className="tabular text-caption text-ink-muted">{r.phone}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex flex-col gap-1">
                            <Pill
                              tone={
                                r.status === 'ready'
                                  ? 'go'
                                  : r.status === 'duplicate'
                                    ? 'neutral'
                                    : 'warn'
                              }
                            >
                              {c.imports.statuses[r.status]}
                            </Pill>
                            {r.problems.length > 0 && (
                              <span className="text-caption text-signal-warn-ink">
                                {r.problems.map((x) => c.imports.problem[x] ?? x).join(' · ')}
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="options" className="panel flex flex-col gap-4 p-5">
          <div>
            <h2 id="options" className="font-display text-lead font-semibold text-ink">
              {c.imports.step2}
            </h2>
            <p className="text-body text-ink-muted">{c.imports.step2Lead}</p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.source}</span>
            <select
              value={opts.source}
              onChange={(e) => setOpts({ ...opts, source: e.target.value })}
              className={field}
            >
              {Object.entries(t.sources)
                .filter(([k]) => k !== 'rte_portal')
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{c.campaign}</span>
            <input
              value={opts.campaign}
              maxLength={60}
              onChange={(e) => setOpts({ ...opts, campaign: e.target.value })}
              className={field}
            />
            <span className="text-caption text-ink-muted">{c.campaignHint}</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{c.owner}</span>
            <select
              value={opts.ownerPersonId}
              onChange={(e) => setOpts({ ...opts, ownerPersonId: e.target.value })}
              className={field}
            >
              <option value="">{c.unassigned}</option>
              {(counsellors.data ?? []).map((x) => (
                <option key={x.personId} value={x.personId}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={!file || !p || p.ready === 0 || commit.isPending}
            onClick={() => file && commit.mutate(file)}
          >
            <FileSpreadsheet aria-hidden className="size-4" />
            {p ? c.imports.importN(p.ready) : c.imports.importNone}
          </Button>
          {commit.error && (
            <p role="alert" className="text-body text-signal-stop-ink">
              {admissionError(commit.error)}
            </p>
          )}
          {commit.data && (
            <Link
              href={`/admissions/leads?year=${year}`}
              className="text-body font-medium text-navy-950 hover:underline"
            >
              {c.imports.seeLeads}
            </Link>
          )}
        </section>
      </div>

      <section aria-labelledby="history" className="panel overflow-hidden">
        <h2
          id="history"
          className="border-b border-line px-5 py-3.5 font-display text-body font-semibold text-ink"
        >
          {c.imports.history}
        </h2>
        {!history.data ? (
          <SkeletonRows rows={2} label={en.states.loading.title} />
        ) : history.data.length === 0 ? (
          <EmptyState compact art="empty" title={c.imports.noHistory} />
        ) : (
          <ul className="divide-y divide-line">
            {(history.data ?? []).map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <FileSpreadsheet aria-hidden className="size-5 shrink-0 text-ink-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium text-ink">{b.fileName}</span>
                  <span className="text-caption text-ink-muted">
                    {[
                      c.imports.counts(b.imported, b.skipped),
                      t.sources[b.source] ?? b.source,
                      b.campaign,
                      b.owner && c.imports.ownedBy(b.owner),
                      c.imports.by(b.by, when(b.at)),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {b.undoneAt ? (
                  <Pill>{c.imports.undoneOn(when(b.undoneAt))}</Pill>
                ) : (
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={b.untouched === 0}
                    onClick={() => setUndoing(b)}
                    aria-label={c.imports.undoFor(b.fileName)}
                  >
                    <RotateCcw aria-hidden className="size-4" />
                    {c.imports.undo}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {undoing && (
        <FormModal
          title={c.imports.undoTitle(undoing.fileName)}
          description={c.imports.undoLead(undoing.untouched, undoing.imported - undoing.untouched)}
          submitLabel={c.imports.undo}
          cancelLabel={en.form.cancel}
          tone="danger"
          pending={undo.isPending}
          error={undo.error ? admissionError(undo.error) : null}
          onClose={() => setUndoing(null)}
          onSubmit={() => undo.mutate(undoing.id)}
        >
          <p className="col-span-full text-body text-ink-muted">{c.imports.undoNote}</p>
        </FormModal>
      )}
      <Announcer message={message} />
    </div>
  );
}
