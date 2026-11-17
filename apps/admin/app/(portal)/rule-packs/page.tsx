'use client';

// Rule packs (rule book §15.1 change process): watch the sources → draft the pack change →
// review → test → release notes → institutions opt in by date. Support staff draft; an owner who
// didn't draft it releases, and only when every test case passes.
import type { CataloguePack, CatalogueVersion } from '@campusverse/platform-rulepacks';
import type { Staff } from '@campusverse/platform-control';
import { Button, PageHeader } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { Chip, Field, Loaded, Notice, field } from '../../../lib/ui';
import { en } from '../../../messages/en';

const t = en.rulePacks;
const json = (v: unknown) => JSON.stringify(v, null, 2);

export default function RulePacksPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Staff>('/me') });
  const list = useQuery({
    queryKey: ['rule-packs'],
    queryFn: () => api.get<CataloguePack[]>('/rule-packs'),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={Gavel} area="navy" title={t.title} description={t.lead} />
      <Loaded q={list} empty={(d) => d.length === 0}>
        {(packs) => (
          <div className="flex flex-col gap-5">
            {packs.map((p) => (
              <PackPanel key={p.pack} pack={p} owner={me.data?.role === 'owner'} />
            ))}
          </div>
        )}
      </Loaded>
    </div>
  );
}

function PackPanel({ pack, owner }: { pack: CataloguePack; owner: boolean }) {
  const [editing, setEditing] = useState(false);
  const draft = pack.versions.find((v) => v.status === 'draft');
  const base = draft ?? pack.versions[0];
  return (
    <section aria-label={pack.title} className="panel flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-body font-semibold text-ink">
          {pack.title} <span className="font-normal text-ink-muted">· {pack.pack}</span>
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setEditing((x) => !x)}>
          {draft ? t.editDraft : t.draftNext}
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {pack.versions.map((v) => (
          <VersionRow key={`${v.version}-${v.status}`} version={v} owner={owner} />
        ))}
      </ul>
      {editing && base && (
        <DraftForm pack={pack.pack} base={base} onDone={() => setEditing(false)} />
      )}
    </section>
  );
}

function VersionRow({ version: v, owner }: { version: CatalogueVersion; owner: boolean }) {
  const qc = useQueryClient();
  const passed = v.results.filter((r) => r.passed).length;
  const failing = v.results.filter((r) => !r.passed);
  const act = useMutation({
    mutationFn: (what: 'release' | 'discard') =>
      what === 'release'
        ? api.post(`/rule-packs/${v.id}/release`, {})
        : api.post(`/rule-packs/${v.id}/discard`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rule-packs'] }),
  });
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-line px-4 py-3">
      <p className="flex flex-wrap items-center gap-2 text-body text-ink">
        <span className="font-medium">{t.version(v.version)}</span>
        <Chip
          tone={
            v.status === 'released' ? 'approved' : v.status === 'draft' ? 'requested' : 'closed'
          }
        >
          {t.status[v.status]}
        </Chip>
        <span className="text-caption text-ink-muted">
          {t.effective(v.effectiveFrom.slice(0, 10))} · {t.tests(passed, v.results.length)}
          {v.draftedBy ? ` · ${t.draftedBy(v.draftedBy)}` : ''}
        </span>
      </p>
      <p className="text-caption text-ink">{v.notes}</p>
      {failing.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-caption text-signal-stop-ink">
          {failing.map((f) => (
            <li key={f.name}>
              {t.failing}: {f.name} ({t.got(JSON.stringify(f.got), JSON.stringify(f.expect))})
            </li>
          ))}
        </ul>
      )}
      {v.status === 'draft' && v.id && (
        <div className="flex flex-wrap items-center gap-2">
          {owner && !v.draftedByMe && (
            <Button
              size="sm"
              disabled={act.isPending || failing.length > 0}
              onClick={() => act.mutate('release')}
            >
              {t.release}
            </Button>
          )}
          <Button
            size="sm"
            variant="quiet"
            disabled={act.isPending}
            onClick={() => act.mutate('discard')}
          >
            {t.discard}
          </Button>
          <Notice error={act.error} ok={act.isSuccess && t.released} />
        </div>
      )}
    </li>
  );
}

function DraftForm({
  pack,
  base,
  onDone,
}: {
  pack: string;
  base: CatalogueVersion;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [effectiveFrom, setEffectiveFrom] = useState(
    base.status === 'draft' ? base.effectiveFrom.slice(0, 10) : '',
  );
  const [notes, setNotes] = useState(base.status === 'draft' ? base.notes : '');
  const [payload, setPayload] = useState(json(base.payload));
  const [sources, setSources] = useState(json(base.sources));
  const [tests, setTests] = useState(json(base.tests));
  const [bad, setBad] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => api.post('/rule-packs', body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rule-packs'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed: Record<string, unknown> = {};
    for (const [key, text, label] of [
      ['payload', payload, t.form.payload],
      ['sources', sources, t.form.sources],
      ['tests', tests, t.form.tests],
    ] as const) {
      try {
        parsed[key] = JSON.parse(text);
      } catch {
        setBad(t.form.badJson(label));
        return;
      }
    }
    setBad(null);
    save.mutate({ pack, effectiveFrom, notes, ...parsed });
  };
  const area = `${field} h-48 py-2 font-mono text-caption`;
  return (
    <form
      onSubmit={submit}
      aria-label={t.draftNext}
      className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2"
    >
      <Field label={t.form.effectiveFrom}>
        <input
          type="date"
          required
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t.form.notes}>
        <input
          required
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={field}
        />
      </Field>
      <Field label={t.form.payload} className="sm:col-span-2">
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          className={area}
          spellCheck={false}
        />
      </Field>
      <Field label={t.form.sources}>
        <textarea
          value={sources}
          onChange={(e) => setSources(e.target.value)}
          className={area}
          spellCheck={false}
        />
      </Field>
      <Field label={t.form.tests}>
        <textarea
          value={tests}
          onChange={(e) => setTests(e.target.value)}
          className={area}
          spellCheck={false}
        />
      </Field>
      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        <div className="flex-1">
          {bad ? (
            <p role="alert" className="text-caption text-signal-stop-ink">
              {bad}
            </p>
          ) : (
            <Notice error={save.error} ok={save.isSuccess && t.saved} />
          )}
        </div>
        <Button type="submit" variant="secondary" disabled={save.isPending}>
          {t.form.save}
        </Button>
      </div>
    </form>
  );
}
