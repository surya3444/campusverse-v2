'use client';

// A subject's marks: one paper, or split into parts (Theory 80 + Internal 20). Used when creating
// an exam (the same split for every subject) and when changing one subject's split.
import { Segmented, cx } from '@campusverse/ui';
import { Plus, X } from 'lucide-react';
import { field, t } from './shared';

export type Part = { name: string; maxMarks: string };

const PRESETS: Record<string, Part[]> = {
  internal: [
    { name: 'Theory', maxMarks: '80' },
    { name: 'Internal', maxMarks: '20' },
  ],
  practical: [
    { name: 'Theory', maxMarks: '70' },
    { name: 'Practical', maxMarks: '30' },
  ],
};

const total = (parts: Part[]) => {
  const h = parts.reduce((a, p) => {
    const m = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(p.maxMarks.trim());
    return m ? a + Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : a;
  }, 0);
  return `${Math.floor(h / 100)}${h % 100 ? `.${String(h % 100).padStart(2, '0')}` : ''}`;
};

/** Ready to save: one paper with marks, or two to four named parts with marks, names not repeated. */
export const partsReady = (parts: Part[]) => {
  const valid = (p: Part) =>
    /^\d{1,4}(\.\d{1,2})?$/.test(p.maxMarks.trim()) && Number(p.maxMarks) > 0;
  if (parts.length === 1) return valid(parts[0] as Part);
  const names = parts.map((p) => p.name.trim().toLowerCase());
  return (
    parts.length >= 2 &&
    parts.length <= 4 &&
    parts.every(valid) &&
    names.every(Boolean) &&
    new Set(names).size === names.length
  );
};

export function PartsEditor({ value, onChange }: { value: Part[]; onChange: (v: Part[]) => void }) {
  const split = value.length > 1;
  const set = (i: number, patch: Partial<Part>) =>
    onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <fieldset className="flex flex-col gap-3 sm:col-span-2">
      <legend className="mb-1.5 text-caption font-medium text-ink">{t.split}</legend>
      <Segmented
        label={t.split}
        value={split ? 'parts' : 'whole'}
        onChange={(v) =>
          onChange(
            v === 'parts'
              ? (PRESETS.internal ?? [])
              : [{ name: '', maxMarks: total(value) || '100' }],
          )
        }
        options={[
          { value: 'whole', label: t.splitWhole },
          { value: 'parts', label: t.splitParts },
        ]}
      />
      {!split ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-muted">{t.maxMarks}</span>
          <input
            required
            inputMode="decimal"
            pattern="\d{1,4}(\.\d{1,2})?"
            value={value[0]?.maxMarks ?? ''}
            onChange={(e) => onChange([{ name: '', maxMarks: e.target.value }])}
            className={cx(field, 'tabular-nums w-32')}
          />
        </label>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-caption text-ink-muted">{t.splitHint}</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(PRESETS).map(([k, parts]) => (
              <button
                key={k}
                type="button"
                onClick={() => onChange(parts)}
                className="rounded-full px-3 py-1 text-caption font-medium text-navy-950 ring-1 ring-line hover:bg-navy-50"
              >
                {t.presets[k]}
              </button>
            ))}
          </div>
          <ol className="flex flex-col gap-2">
            {value.map((p, i) => (
              <li key={i} className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-caption text-ink-muted">
                  {t.partName(i + 1)}
                  <input
                    required
                    maxLength={30}
                    value={p.name}
                    onChange={(e) => set(i, { name: e.target.value })}
                    className={field}
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-caption text-ink-muted">
                  {t.partMax(i + 1)}
                  <input
                    required
                    inputMode="decimal"
                    pattern="\d{1,4}(\.\d{1,2})?"
                    value={p.maxMarks}
                    onChange={(e) => set(i, { maxMarks: e.target.value })}
                    className={cx(field, 'tabular-nums')}
                  />
                </label>
                <button
                  type="button"
                  aria-label={t.removePart(i + 1)}
                  disabled={value.length <= 2}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  className="flex size-9 items-center justify-center rounded-md text-ink-muted hover:bg-navy-50 hover:text-navy-950 disabled:opacity-40"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={value.length >= 4}
              onClick={() => onChange([...value, { name: '', maxMarks: '10' }])}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-body font-medium text-navy-950 hover:bg-navy-50 disabled:opacity-40"
            >
              <Plus aria-hidden className="size-4" />
              {t.addPart}
            </button>
            <span className="tabular-nums text-caption font-medium text-ink" aria-live="polite">
              {t.splitTotal(total(value))}
            </span>
          </div>
        </div>
      )}
    </fieldset>
  );
}
