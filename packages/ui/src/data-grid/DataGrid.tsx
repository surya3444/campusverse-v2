'use client';

import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { CheckCircle2, CloudOff, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../primitives';
import { checkMark, normaliseMark, parseClipboard, pasteTargets, type CellProblem } from './cells';

export type GridColumn = { id: string; header: string; max: number };
export type GridRow = { id: string; name: string; meta?: string; values: Record<string, string> };

export type GridLabels = {
  caption: string;
  name: string;
  outOf: (max: number) => string;
  progress: (entered: number, total: number) => string;
  errors: (count: number) => string;
  problem: Record<CellProblem, (max: number) => string>;
  pasted: (count: number) => string;
  saved: (at: string) => string;
  saving: string;
  offline: string;
  openRecord: (name: string) => string;
};

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, GridRow>();

/**
 * Spreadsheet-style marks entry. Arrow keys move, typing starts an edit, Enter saves and moves
 * down, Escape cancels, paste fills from the active cell. The name column stays put while
 * scrolling sideways. Every change is reported at once so the caller can autosave.
 */
export function DataGrid({
  columns,
  rows,
  onChange,
  onOpenRow,
  saveState,
  savedAt,
  labels,
}: {
  columns: GridColumn[];
  rows: GridRow[];
  onChange: (rowId: string, columnId: string, value: string) => void;
  onOpenRow?: (rowId: string) => void;
  saveState: 'saved' | 'saving' | 'offline';
  savedAt?: string;
  labels: GridLabels;
}) {
  const tableColumns = useMemo(
    () =>
      helper.columns([
        helper.accessor('name', { header: labels.name }),
        ...columns.map((c) => helper.display({ id: c.id, header: c.header })),
      ]),
    [columns, labels.name],
  );
  const table = useTable({ features, columns: tableColumns, data: rows });
  const modelRows = table.getRowModel().rows;

  const [active, setActive] = useState({ r: 0, c: 1 });
  const [editing, setEditing] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const cells = useRef(new Map<string, HTMLElement>());
  const editor = useRef<HTMLInputElement>(null);

  const lastRow = rows.length - 1;
  const lastCol = columns.length; // column 0 is the name

  useEffect(() => {
    if (editing !== null) editor.current?.focus();
    else cells.current.get(`${active.r}:${active.c}`)?.focus();
  }, [active, editing]);

  const move = (dr: number, dc: number) =>
    setActive((a) => ({
      r: Math.min(lastRow, Math.max(0, a.r + dr)),
      c: Math.min(lastCol, Math.max(0, a.c + dc)),
    }));

  const commit = (value: string) => {
    const row = rows[active.r];
    const col = columns[active.c - 1];
    if (row && col) onChange(row.id, col.id, normaliseMark(value));
    setEditing(null);
  };

  const onGridKey = (e: KeyboardEvent) => {
    if (editing !== null) return;
    const row = rows[active.r];
    const col = columns[active.c - 1];
    const keys: Record<string, () => void> = {
      ArrowUp: () => move(-1, 0),
      ArrowDown: () => move(1, 0),
      ArrowLeft: () => move(0, -1),
      ArrowRight: () => move(0, 1),
      Home: () => setActive((a) => ({ ...a, c: 0 })),
      End: () => setActive((a) => ({ ...a, c: lastCol })),
      Enter: () => (col ? setEditing(row?.values[col.id] ?? '') : row && onOpenRow?.(row.id)),
      F2: () => col && setEditing(row?.values[col.id] ?? ''),
      Delete: () => row && col && onChange(row.id, col.id, ''),
      Backspace: () => row && col && onChange(row.id, col.id, ''),
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    } else if (col && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setEditing(e.key); // typing replaces, as in Excel
    }
  };

  const onEditorKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    const after: Record<string, [number, number]> = {
      Enter: [1, 0],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      Tab: [0, e.shiftKey ? -1 : 1],
    };
    const step = after[e.key];
    if (step) {
      e.preventDefault();
      commit(value);
      move(step[0], step[1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(null);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editing !== null) return;
    e.preventDefault();
    const targets = pasteTargets(
      { row: active.r, col: Math.max(0, active.c - 1) },
      parseClipboard(e.clipboardData.getData('text/plain')),
      { rows: rows.length, cols: columns.length },
    );
    for (const t of targets) {
      const row = rows[t.row];
      const col = columns[t.col];
      if (row && col) onChange(row.id, col.id, normaliseMark(t.value));
    }
    setAnnouncement(labels.pasted(targets.length));
  };

  let entered = 0;
  let problems = 0;
  for (const r of rows)
    for (const c of columns) {
      const v = r.values[c.id] ?? '';
      if (checkMark(v, c.max)) problems++;
      else if (v !== '') entered++;
    }
  const total = rows.length * columns.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="panel overflow-x-auto">
        <table
          role="grid"
          aria-label={labels.caption}
          aria-rowcount={rows.length + 1}
          onKeyDown={onGridKey}
          onPaste={onPaste}
          className="w-full border-collapse text-body"
        >
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-line bg-paper">
                {group.headers.map((header, ci) => {
                  const col = columns[ci - 1];
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      data-plain
                      className={cx(
                        'px-3 py-2.5 text-left text-caption font-medium whitespace-nowrap text-ink-muted',
                        ci === 0
                          ? 'sticky left-0 z-10 min-w-48 border-r border-line bg-paper'
                          : 'min-w-28 text-right',
                      )}
                    >
                      <span className="block text-caption font-semibold text-ink">
                        <table.FlexRender header={header} />
                      </span>
                      {col && <span className="tabular">{labels.outOf(col.max)}</span>}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {modelRows.map((modelRow, ri) => {
              const row = modelRow.original;
              return (
                <tr key={modelRow.id} className="border-b border-line last:border-b-0">
                  <th
                    scope="row"
                    role="gridcell"
                    tabIndex={active.r === ri && active.c === 0 ? 0 : -1}
                    ref={(el) =>
                      void (el ? cells.current.set(`${ri}:0`, el) : cells.current.delete(`${ri}:0`))
                    }
                    onClick={() => setActive({ r: ri, c: 0 })}
                    className="sticky left-0 z-10 border-r border-line bg-surface px-3 py-2 text-left font-normal"
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onOpenRow?.(row.id)}
                      aria-label={labels.openRecord(row.name)}
                      className="text-left font-medium text-navy-950 underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </button>
                    {row.meta && (
                      <span className="tabular block text-caption text-ink-muted">{row.meta}</span>
                    )}
                  </th>
                  {columns.map((col, i) => {
                    const ci = i + 1;
                    const value = row.values[col.id] ?? '';
                    const problem = checkMark(value, col.max);
                    const isActive = active.r === ri && active.c === ci;
                    return (
                      <td
                        key={col.id}
                        role="gridcell"
                        aria-invalid={problem ? true : undefined}
                        tabIndex={isActive && editing === null ? 0 : -1}
                        ref={(el) =>
                          void (el
                            ? cells.current.set(`${ri}:${ci}`, el)
                            : cells.current.delete(`${ri}:${ci}`))
                        }
                        onClick={() => setActive({ r: ri, c: ci })}
                        onDoubleClick={() => setEditing(value)}
                        className={cx(
                          'tabular relative h-11 px-3 text-right',
                          problem && 'bg-signal-stop-tint font-medium text-signal-stop-ink',
                          isActive && 'outline-2 -outline-offset-2 outline-navy-950',
                        )}
                      >
                        {isActive && editing !== null ? (
                          <input
                            ref={editor}
                            defaultValue={editing}
                            onKeyDown={onEditorKey}
                            onBlur={(e) => commit(e.currentTarget.value)}
                            aria-label={`${row.name}, ${col.header}`}
                            inputMode="decimal"
                            className="tabular absolute inset-0 w-full bg-navy-50 px-3 text-right text-ink outline-none"
                          />
                        ) : (
                          <>
                            {value}
                            {problem && (
                              <span className="sr-only">{labels.problem[problem](col.max)}</span>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-caption">
        <span className="tabular text-ink">{labels.progress(entered, total)}</span>
        {problems > 0 && (
          <span className="tabular font-medium text-signal-stop-ink">
            {labels.errors(problems)}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-2 text-ink-muted">
          {saveState === 'saving' && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {saveState === 'saved' && <CheckCircle2 aria-hidden className="size-4 text-signal-go" />}
          {saveState === 'offline' && <CloudOff aria-hidden className="size-4 text-signal-warn" />}
          {saveState === 'saving'
            ? labels.saving
            : saveState === 'offline'
              ? labels.offline
              : savedAt
                ? labels.saved(savedAt)
                : null}
        </span>
        <span aria-live="polite" className="sr-only">
          {announcement}
        </span>
      </div>
    </div>
  );
}
