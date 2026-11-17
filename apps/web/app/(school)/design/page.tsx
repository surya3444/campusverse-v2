'use client';

import { Button, DataGrid, StatePanel, type GridRow } from '@campusverse/ui';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { en } from '../../../messages/en';
import iconWhite from '@campusverse/ui/brand/icon-white.svg';
import logoColored from '@campusverse/ui/brand/logo-colored.svg';
import logoWhite from '@campusverse/ui/brand/logo-white.svg';
import { useSchoolActions } from '../shell';
import { markColumns, markRows } from '../synthetic';

const d = en.design;

const COLOURS: [name: string, hex: string, use: string][] = [
  ['navy-950', '#04266D', 'Main actions, active item, the now line'],
  ['navy-50', '#F1F5FC', 'Selected and hover backgrounds'],
  ['cyan-400', '#0AC5FF', 'Brand accent and focus halo. Never text on white'],
  ['paper', '#F6F8FB', 'Page background'],
  ['surface', '#FFFFFF', 'Panels'],
  ['line', '#E4E9F0', 'Hairline borders'],
  ['ink', '#0E1B33', 'Body text'],
  ['ink-muted', '#56637A', 'Secondary text (5.9:1 on white)'],
  ['signal-go', '#0B8A5A', 'Done'],
  ['signal-warn', '#C27803', 'Needs attention'],
  ['signal-stop', '#C4314B', 'Blocked or urgent'],
];

const SCALE: [cls: string, px: number][] = [
  ['text-hero', 48],
  ['text-display', 32],
  ['text-title', 24],
  ['text-lead', 18],
  ['text-body', 15],
  ['text-caption', 13],
];

// Script names in their own scripts: a glyph check, not a translation.
const SCRIPTS: [lang: string, sample: string][] = [
  ['kn', 'ಕನ್ನಡ · ೧೨೩೪'],
  ['te', 'తెలుగు · ౧౨౩౪'],
  ['ta', 'தமிழ் · ௧௨௩௪'],
  ['hi', 'हिन्दी · १२३४'],
  ['ur', 'اردو · ۱۲۳۴'],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6">
      <h2 className="text-lead font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystem() {
  const { openStudent, openRemind, announce } = useSchoolActions();
  const [rows, setRows] = useState<GridRow[]>(markRows);
  const [save, setSave] = useState<'saved' | 'saving'>('saved');
  const [savedAt, setSavedAt] = useState('09:41');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (rowId: string, colId: string, value: string) => {
    setRows((rs) =>
      rs.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, [colId]: value } } : r)),
    );
    // Synthetic autosave: a real grid saves through the API with an idempotency key.
    setSave('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSave('saved');
      setSavedAt(
        new Date().toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Kolkata',
        }),
      );
    }, 700);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10">
      <div>
        <h1 className="text-title font-semibold text-ink">{d.title}</h1>
        <p className="text-body text-ink-muted">{d.intro}</p>
      </div>

      <Section title={d.brand}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="panel flex items-center p-8">
            <Image src={logoColored} alt={en.app.name} className="h-16 w-auto" />
          </div>
          <div className="flex items-center gap-8 rounded-lg midnight p-8">
            <Image src={logoWhite} alt={en.app.name} className="h-16 w-auto" />
            <Image src={iconWhite} alt="" className="size-14" />
          </div>
        </div>
      </Section>

      <Section title={d.colours}>
        <ul className="panel divide-y divide-line">
          {COLOURS.map(([name, hex, use]) => (
            <li key={name} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <span
                className="size-10 shrink-0 rounded-md border border-line"
                style={{ background: hex }}
              />
              <code className="w-32 shrink-0 text-body font-medium text-ink">{name}</code>
              <code className="tabular w-20 shrink-0 text-caption text-ink-muted">{hex}</code>
              <span className="min-w-0 basis-full text-body text-ink sm:flex-1 sm:basis-auto">
                {use}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={d.type}>
        <div className="flex flex-col gap-2">
          {SCALE.map(([cls, px]) => (
            <p key={cls} className={`${cls} truncate font-bold text-ink`}>
              <span className="tabular mr-4 text-caption font-normal text-ink-muted">{px}px</span>
              Campusverse 1,262 ₹1,24,500
            </p>
          ))}
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {SCRIPTS.map(([lang, sample]) => (
            <li key={lang} lang={lang} className="panel px-4 py-3 text-title text-ink">
              {sample}
            </li>
          ))}
        </ul>
        <p className="text-body text-ink-muted">{d.typeNote}</p>
      </Section>

      <Section title={d.buttons}>
        <div className="flex flex-wrap items-center gap-3">
          <Button>{d.primary}</Button>
          <Button variant="secondary">{d.secondary}</Button>
          <Button variant="quiet">{d.quiet}</Button>
          <Button disabled>{d.primary}</Button>
        </div>
      </Section>

      <Section title={d.states}>
        <div className="grid gap-4 md:grid-cols-2">
          <StatePanel kind="loading" title={en.states.loading.title} />
          <StatePanel kind="empty" title={en.states.empty.title} body={en.states.empty.body} />
          <StatePanel
            kind="error"
            title={en.states.error.title}
            body={en.states.error.body}
            action={en.states.error.action}
            onAction={() => announce(en.states.error.action)}
          />
          <StatePanel
            kind="offline"
            title={en.states.offline.title}
            body={en.states.offline.body}
          />
          <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
        </div>
      </Section>

      <Section title={d.dayLineStates}>
        <ul className="flex flex-wrap gap-3">
          {(['ready', 'loading', 'empty', 'error', 'offline', 'denied'] as const).map((s) => (
            <li key={s}>
              <Link
                href={`/?state=${s}&at=10:05`}
                className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3.5 font-medium text-ink hover:bg-navy-50"
              >
                {s}
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={d.grid}>
        <p className="max-w-prose text-body text-ink-muted">{d.gridHelp}</p>
        <DataGrid
          columns={markColumns}
          rows={rows}
          onChange={onChange}
          onOpenRow={openStudent}
          saveState={save}
          savedAt={savedAt}
          labels={en.grid}
        />
      </Section>

      <Section title={d.overlays}>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => openStudent('s1')}>
            {d.openDrawer}
          </Button>
          <Button variant="secondary" onClick={openRemind}>
            {d.openCanvas}
          </Button>
          <Button variant="secondary" onClick={() => announce(d.announced)}>
            {d.announce}
          </Button>
        </div>
      </Section>
    </div>
  );
}
