'use client';

import type { AudienceGroup, Language, NoticeKind } from '@campusverse/shared-communications';
import { Button, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { noticeError } from '../notices-list';

const t = en.notices;
const LANGS: Language[] = ['en', 'kn', 'te', 'ta', 'hi', 'ur'];
const KINDS: NoticeKind[] = ['notice', 'circular', 'urgent'];
const field =
  'rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';

type Version = { language: Language; title: string; body: string };

/** Compose: one English version, plus any parent languages. Saved as a draft for approval. */
export function ComposeForm({
  initial = { title: '', body: '' },
}: {
  initial?: { title: string; body: string };
}) {
  const router = useRouter();
  const school = useInstitution();
  const id = school.institutionId;
  const [kind, setKind] = useState<NoticeKind>('notice');
  const [whole, setWhole] = useState(true);
  const [groups, setGroups] = useState<string[]>([]);
  const [needsAck, setNeedsAck] = useState(false);
  const [versions, setVersions] = useState<Version[]>([{ language: 'en', ...initial }]);
  const options = useQuery({
    queryKey: ['audience-groups', id],
    queryFn: () => api.get<AudienceGroup[]>(`/communications/${id}/audience-groups`),
    enabled: !!id,
  });
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/communications/${id}/notices`, {
        kind,
        needsAck,
        audience: whole ? { type: 'school' } : { type: 'groups', groupIds: groups },
        versions,
      }),
    onSuccess: (n) => router.push(`/notices/${n.id}`),
  });

  if (school.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  const edit = (i: number, patch: Partial<Version>) =>
    setVersions((v) => v.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const unused = LANGS.filter((l) => !versions.some((v) => v.language === l));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-[760px] flex-col gap-5">
      <Link
        href="/notices"
        className="inline-flex items-center gap-1.5 self-start text-body text-navy-950 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.title}
      </Link>
      <h1 className="text-title font-semibold text-ink">{t.compose}</h1>

      <fieldset className="panel flex flex-col gap-3 p-5">
        <legend className="sr-only">{t.kind}</legend>
        <span className="text-caption font-medium text-ink">{t.kind}</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <label
              key={k}
              className={cx(
                'flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2.5',
                kind === k ? 'border-navy-950 bg-navy-50' : 'border-line hover:bg-paper',
              )}
            >
              <span className="flex items-center gap-2 text-body font-medium text-ink">
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                {t.kinds[k]}
              </span>
              <span className="text-caption text-ink-muted">{t.kindHint[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel flex flex-col gap-3 p-5">
        <legend className="sr-only">{t.audience}</legend>
        <span className="text-caption font-medium text-ink">{t.audience}</span>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-body text-ink">
            <input type="radio" name="audience" checked={whole} onChange={() => setWhole(true)} />
            {t.wholeSchool}
          </label>
          <label className="flex items-center gap-2 text-body text-ink">
            <input type="radio" name="audience" checked={!whole} onChange={() => setWhole(false)} />
            {t.chooseGroups}
          </label>
        </div>
        {!whole && (
          <div className="flex flex-wrap gap-2">
            {(options.data ?? []).map((g) => {
              const on = groups.includes(g.id);
              return (
                <label
                  key={g.id}
                  className={cx(
                    'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-caption',
                    on ? 'border-navy-950 bg-navy-50 text-navy-950' : 'border-line text-ink',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() =>
                      setGroups((x) => (on ? x.filter((y) => y !== g.id) : [...x, g.id]))
                    }
                  />
                  {g.label}
                </label>
              );
            })}
          </div>
        )}
        <label className="flex items-center gap-2 text-body text-ink">
          <input
            type="checkbox"
            checked={needsAck}
            onChange={(e) => setNeedsAck(e.target.checked)}
          />
          {t.needsAck}
        </label>
      </fieldset>

      {versions.map((v, i) => (
        <fieldset
          key={v.language}
          className="panel flex flex-col gap-3 p-5"
          lang={v.language}
          dir={v.language === 'ur' ? 'rtl' : 'ltr'}
        >
          <legend className="sr-only">{t.languages[v.language]}</legend>
          <div className="flex items-center justify-between gap-3">
            <span className="text-body font-semibold text-ink">{t.languages[v.language]}</span>
            {v.language !== 'en' && (
              <Button
                size="sm"
                variant="quiet"
                onClick={() => setVersions((x) => x.filter((_, j) => j !== i))}
              >
                {t.remove}
              </Button>
            )}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.titleLabel}</span>
            <input
              required
              maxLength={200}
              value={v.title}
              onChange={(e) => edit(i, { title: e.target.value })}
              className={cx(field, 'h-9')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.bodyLabel}</span>
            <textarea
              required
              maxLength={4000}
              rows={5}
              value={v.body}
              onChange={(e) => edit(i, { body: e.target.value })}
              className={cx(field, 'py-2')}
            />
          </label>
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        {unused.length > 0 && (
          <label className="flex items-center gap-2 text-body text-ink">
            <span className="text-caption font-medium">{t.addLanguage}</span>
            <select
              value=""
              onChange={(e) =>
                e.target.value &&
                setVersions((x) => [
                  ...x,
                  { language: e.target.value as Language, title: '', body: '' },
                ])
              }
              className={cx(field, 'h-9')}
            >
              <option value="">—</option>
              {unused.map((l) => (
                <option key={l} value={l}>
                  {t.languages[l]}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="flex-1" />
        <Button type="submit" disabled={save.isPending || !id}>
          {t.saveDraft}
        </Button>
      </div>
      {save.isError && (
        <p
          role="alert"
          className="rounded-md bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink"
        >
          {noticeError(save.error)}
        </p>
      )}
    </form>
  );
}
