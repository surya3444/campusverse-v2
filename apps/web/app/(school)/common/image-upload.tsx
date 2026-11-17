'use client';

// One way to upload a picture anywhere: photos are cropped to a square, logos and signatures
// keep their shape; everything is shrunk on the device first. The server scans the file before
// anyone can see it, so we wait for that and say so.
import { Avatar, Button, cx } from '@campusverse/ui';
import { useState, useRef } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';

const t = en.imageUpload;

/** Square crop for photos; logos and signatures keep their proportions. PNG stays PNG (transparency). */
async function prepare(file: File, shape: 'round' | 'wide'): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const max = shape === 'round' ? 640 : 1200;
  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (shape === 'round') {
    const side = Math.min(sw, sh);
    sx = (sw - side) / 2;
    sy = (sh - side) / 2;
    sw = sh = side;
  }
  const scale = Math.min(1, max / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d')?.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const type = file.type === 'image/png' && shape === 'wide' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.88));
  if (!blob) return file;
  return new File([blob], type === 'image/png' ? 'image.png' : 'image.jpg', { type });
}

async function waitUntilScanned(fileId: string): Promise<'clean' | 'refused'> {
  for (let i = 0; i < 30; i++) {
    const { state } = await api.get<{ state: string }>(`/files/${fileId}/state`);
    if (state === 'clean') return 'clean';
    if (state === 'infected' || state === 'rejected') return 'refused';
    await new Promise((r) => setTimeout(r, 700));
  }
  return 'clean'; // Still pending after ~20 s: the picture appears once it is cleared.
}

export function ImageUpload({
  label,
  name,
  src,
  currentFileId,
  uploadPath,
  removePath,
  shape = 'round',
  canEdit = true,
  hint = t.hint,
  compact = false,
  onChanged,
}: {
  label: string;
  /** For the initials shown when there is no photo. */
  name: string;
  /** The image URL without a version; the file id is appended so a new picture shows at once. */
  src: string;
  /** The picture on file now (null if none): it versions the URL so caches never show an old one. */
  currentFileId: string | null;
  uploadPath: string;
  removePath?: string | undefined;
  shape?: 'round' | 'wide';
  canEdit?: boolean;
  hint?: string;
  /** For record headers: a smaller picture and just a Change button. */
  compact?: boolean;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'working' | 'checking' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null | undefined>(undefined);
  const shown = fileId === undefined ? currentFileId : fileId;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setState('working');
    try {
      const ready = await prepare(file, shape).catch(() => file);
      const { fileId: id } = await api.upload<{ fileId: string }>(uploadPath, ready);
      setState('checking');
      if ((await waitUntilScanned(id)) === 'refused') {
        setError(t.refused);
        setState('idle');
        return;
      }
      setFileId(id);
      setState('done');
      onChanged();
    } catch (e) {
      setError(
        e instanceof ApiFailure
          ? e.status === 403
            ? (t.errors.forbidden ?? '')
            : (t.errors[e.code] ?? t.errors.error ?? '')
          : (t.errors.error ?? ''),
      );
      setState('idle');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    if (!removePath) return;
    await api.post(removePath);
    setFileId(null);
    onChanged();
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png"
      aria-label={`${label}: ${t.upload}`}
      className="sr-only"
      onChange={(e) => void pick(e.target.files?.[0])}
    />
  );
  if (compact)
    return (
      <div className="flex shrink-0 flex-col items-center gap-1">
        <span className="rounded-full bg-surface p-[5px] shadow-[var(--shadow-lift)]">
          <Avatar name={name} size="xl" src={shown ? `${src}?v=${shown}` : null} />
        </span>
        {canEdit && (
          <>
            <button
              type="button"
              disabled={state === 'working' || state === 'checking'}
              onClick={() => input.current?.click()}
              className="rounded-md px-2 py-0.5 text-caption font-medium text-navy-950 hover:bg-navy-50"
            >
              {state === 'working' || state === 'checking' ? t.checking : t.change}
            </button>
            {fileInput}
            {error && (
              <span role="alert" className="max-w-40 text-center text-caption text-signal-stop-ink">
                {error}
              </span>
            )}
          </>
        )}
      </div>
    );

  return (
    <div className="flex items-center gap-5">
      {shape === 'round' ? (
        <Avatar name={name} size="xl" src={shown ? `${src}?v=${shown}` : null} />
      ) : (
        <span className="flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-strong bg-paper p-2">
          {shown && (
            <img
              src={`${src}?v=${shown}`}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          )}
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-body font-medium text-ink">{label}</span>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={state === 'working' || state === 'checking'}
              onClick={() => input.current?.click()}
            >
              {t.change}
            </Button>
            {removePath && (
              <Button variant="quiet" onClick={() => void remove()}>
                {t.remove}
              </Button>
            )}
            {fileInput}
          </div>
        )}
        <span
          role="status"
          className={cx('text-caption', error ? 'text-signal-stop-ink' : 'text-ink-muted')}
        >
          {error ??
            (state === 'working' || state === 'checking'
              ? t.checking
              : state === 'done'
                ? t.ready
                : canEdit
                  ? hint
                  : '')}
        </span>
      </div>
    </div>
  );
}
