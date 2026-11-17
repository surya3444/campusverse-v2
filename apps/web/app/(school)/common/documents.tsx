'use client';

// A person's documents in folders (staff now, students in Milestone 21): upload with a title,
// versions kept, open (audited on the server), verify or reject with a reason.
import type { RecordDocument } from '@campusverse/people-records';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  cx,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, Image as ImageIcon, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { ago } from './activity';
import { fieldInput } from './custom-fields';

const t = en.documentsPanel;
const STATUS_TONE: Record<string, Tone> = {
  received: 'warn',
  verified: 'go',
  rejected: 'stop',
  superseded: 'neutral',
};
const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** A stable kind from the title: "PAN card" → pan_card, so the same title is a new version. */
const kindOf = (title: string) => {
  const k = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(k) && k.length >= 2 ? k : `doc_${k || 'file'}`.slice(0, 40);
};

type Listing = { documents: RecordDocument[]; canChange: boolean; names: Record<string, string> };

/** Where a record's documents live: a person's or an applicant's. */
export type DocumentPaths = {
  list: string;
  upload: string;
  check: (documentId: string) => string;
  file: (documentId: string) => string;
};
export const personDocuments = (personId: string): DocumentPaths => ({
  list: `/people/${personId}/documents`,
  upload: `/people/${personId}/documents`,
  check: (id) => `/people/documents/${id}/check`,
  file: (id) => `/api/v1/people/documents/${id}/file`,
});

export function DocumentsPanel({
  paths,
  folders,
  canChange,
}: {
  paths: DocumentPaths;
  /** The folders this kind of record uses, in order. */
  folders: readonly string[];
  /** For listings that don't say (applicants): whether this person may add and check. */
  canChange?: boolean;
}) {
  const qc = useQueryClient();
  const key = ['documents', paths.list];
  const list = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Listing> => {
      const r = await api.get<Omit<Listing, 'canChange'> & { canChange?: boolean }>(paths.list);
      return { ...r, canChange: canChange ?? r.canChange ?? false };
    },
  });
  const [folder, setFolder] = useState<string>('all');
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['stamps'] });
  };

  if (list.isPending) return <SkeletonRows rows={4} label={en.states.loading.title} />;
  if (list.isError || !list.data)
    return list.error instanceof ApiFailure && list.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={t.denied} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} />
    );

  const docs = list.data.documents;
  const latest = docs.filter((d) => d.status !== 'superseded');
  const shown = latest.filter((d) => folder === 'all' || d.folder === folder);
  const count = (f: string) => latest.filter((d) => d.folder === f).length;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label={t.title} className="panel p-2">
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {['all', ...folders].map((f) => (
            <li key={f} className="shrink-0">
              <button
                type="button"
                aria-current={f === folder ? 'true' : undefined}
                onClick={() => setFolder(f)}
                className={cx(
                  'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-body',
                  f === folder
                    ? 'bg-navy-50 font-semibold text-navy-950'
                    : 'text-ink hover:bg-paper',
                )}
              >
                {f === 'all' ? t.all : t.folders[f]}
                <span className="tabular text-caption text-ink-muted">
                  {f === 'all' ? latest.length : count(f)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-col gap-4">
        {list.data.canChange && !adding && (
          <div>
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-4" />
              {t.add}
            </Button>
          </div>
        )}
        {adding && (
          <AddDocument
            uploadPath={paths.upload}
            folders={folders}
            initialFolder={folder === 'all' ? (folders[0] ?? 'other') : folder}
            onCancel={() => setAdding(false)}
            onDone={() => {
              setAdding(false);
              refresh();
            }}
          />
        )}
        <Section
          title={folder === 'all' ? t.title : (t.folders[folder] ?? '')}
          description={t.lead}
          flush
        >
          {shown.length === 0 ? (
            <EmptyState
              compact
              art="empty"
              title={t.empty}
              body={list.data.canChange ? t.emptyBody : undefined}
            />
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((d) => (
                <DocumentRow
                  key={d.id}
                  paths={paths}
                  doc={d}
                  earlier={docs.filter((x) => x.kind === d.kind && x.id !== d.id)}
                  names={list.data.names}
                  canCheck={list.data.canChange}
                  onChanged={refresh}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function DocumentRow({
  paths,
  doc: d,
  earlier,
  names,
  canCheck,
  onChanged,
}: {
  paths: DocumentPaths;
  doc: RecordDocument;
  earlier: RecordDocument[];
  names: Record<string, string>;
  canCheck: boolean;
  onChanged: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const check = useMutation({
    mutationFn: (status: 'verified' | 'rejected') =>
      api.post(paths.check(d.id), {
        status,
        note: status === 'rejected' ? note : null,
      }),
    onSuccess: () => {
      setRejecting(false);
      onChanged();
    },
  });
  const who = (id: string | null) =>
    id ? (names[id] ?? en.activity.someone) : en.activity.someone;
  const expired = d.expiresOn !== null && d.expiresOn < new Date().toISOString().slice(0, 10);
  const Icon = d.contentType === 'application/pdf' ? FileText : ImageIcon;
  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy-950">
          <Icon aria-hidden className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-body font-semibold text-ink">{d.title}</span>
            <Pill tone={STATUS_TONE[d.status] ?? 'neutral'}>{t.statuses[d.status]}</Pill>
            {d.version > 1 && (
              <span className="text-caption text-ink-muted">{t.version(d.version)}</span>
            )}
            {d.expiresOn && (
              <Pill tone={expired ? 'stop' : 'neutral'}>
                {expired ? t.expired : t.expiresOn(day.format(new Date(`${d.expiresOn}T00:00:00`)))}
              </Pill>
            )}
          </span>
          <span className="text-caption text-ink-muted">
            {t.folders[d.folder]} · {t.size(Math.max(1, Math.round(d.sizeBytes / 1024)))} ·{' '}
            {t.uploadedBy(who(d.uploadedBy), ago(d.uploadedAt))}
          </span>
          {d.checkedAt && (
            <span className="text-caption text-ink-muted">
              {t.checkedBy(who(d.checkedBy), ago(d.checkedAt))}
              {d.note ? ` · ${d.note}` : ''}
            </span>
          )}
        </span>
        <span className="flex flex-wrap gap-2">
          <a
            href={paths.file(d.id)}
            target="_blank"
            rel="noopener"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-body font-medium text-ink hover:bg-paper"
          >
            <ExternalLink aria-hidden className="size-4" />
            {t.open}
            <span className="sr-only">: {d.title}</span>
          </a>
          {canCheck && d.status === 'received' && (
            <>
              <Button variant="secondary" onClick={() => setRejecting(true)} aria-haspopup="dialog">
                {t.reject}
              </Button>
              <Button onClick={() => check.mutate('verified')} disabled={check.isPending}>
                {t.verify}
              </Button>
            </>
          )}
        </span>
      </div>
      {rejecting && (
        <FormModal
          title={`${t.reject}: ${d.title}`}
          size="md"
          tone="danger"
          submitLabel={t.reject}
          cancelLabel={en.form.cancel}
          pending={check.isPending}
          error={check.isError ? en.imageUpload.errors.error : null}
          onClose={() => {
            check.reset();
            setRejecting(false);
          }}
          onSubmit={() => check.mutate('rejected')}
        >
          <ModalField label={t.rejectReason} wide>
            <input
              required
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={fieldInput}
            />
          </ModalField>
        </FormModal>
      )}
      {earlier.length > 0 && (
        <details className="pl-13">
          <summary className="cursor-pointer text-caption font-medium text-ink-muted">
            {t.earlier(earlier.length)}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {earlier.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-caption text-ink-muted">
                <span>{t.version(e.version)}</span>·<span>{ago(e.uploadedAt)}</span>
                <a
                  href={paths.file(e.id)}
                  target="_blank"
                  rel="noopener"
                  className="font-medium text-navy-950 hover:underline"
                >
                  {t.open}
                  <span className="sr-only">: {t.version(e.version)}</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function AddDocument({
  uploadPath,
  folders,
  initialFolder,
  onCancel,
  onDone,
}: {
  uploadPath: string;
  folders: readonly string[];
  initialFolder: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [folder, setFolder] = useState(initialFolder);
  const [title, setTitle] = useState('');
  const [expires, setExpires] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async () => {
      const f = file.current?.files?.[0];
      if (!f) throw new ApiFailure(400, 'file_missing', 'file');
      // Fields go before the file: the API reads them as the upload streams in.
      const form = new FormData();
      form.append('folder', folder);
      form.append('kind', kindOf(title));
      form.append('title', title.trim());
      if (expires) form.append('expiresOn', expires);
      form.append('file', f);
      const res = await fetch(`/api/v1${uploadPath}`, {
        method: 'POST',
        headers: { 'x-requested-with': 'campusverse' },
        body: form,
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { code?: string };
        throw new ApiFailure(res.status, b.code ?? 'error', b.code ?? 'error');
      }
    },
    onSuccess: onDone,
  });
  const error =
    upload.error instanceof ApiFailure
      ? (en.imageUpload.errors[upload.error.status === 403 ? 'forbidden' : upload.error.code] ??
        en.imageUpload.errors.error)
      : upload.isError
        ? en.imageUpload.errors.error
        : '';
  return (
    <FormModal
      title={t.add}
      submitLabel={upload.isPending ? t.uploading : t.upload}
      cancelLabel={en.form.cancel}
      pending={upload.isPending}
      error={error || null}
      onClose={onCancel}
      onSubmit={() => upload.mutate()}
    >
      <>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.docTitle}</span>
          <input
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldInput}
          />
          <span className="text-caption text-ink-muted">{t.docTitleHint}</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.folder}</span>
          <select value={folder} onChange={(e) => setFolder(e.target.value)} className={fieldInput}>
            {folders.map((f) => (
              <option key={f} value={f}>
                {t.folders[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.file}</span>
          <input
            ref={file}
            required
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="text-body text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-navy-50 file:px-3 file:py-2 file:font-medium file:text-navy-950"
          />
          <span className="text-caption text-ink-muted">{t.fileHint}</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.expires}</span>
          <input
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className={fieldInput}
          />
          <span className="text-caption text-ink-muted">{t.expiresHint}</span>
        </label>
      </>
    </FormModal>
  );
}
