'use client';

import type { StaffRow } from '@campusverse/platform-control';
import { Button, PageHeader } from '@campusverse/ui';
import { UserCog } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { Chip, Field, Loaded, Notice, field } from '../../../lib/ui';
import { en } from '../../../messages/en';

const t = en.staff;
const linkFor = (token: string) => `${window.location.origin}/enrol?token=${token}`;

export default function StaffPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['staff'], queryFn: () => api.get<StaffRow[]>('/staff') });
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'support'>('support');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['staff'] });
  const add = useMutation({
    mutationFn: () => api.post<{ enrolToken: string }>('/staff', { name, email, role }),
    onSuccess: (r) => {
      setLink(linkFor(r.enrolToken));
      setName('');
      setEmail('');
      refresh();
    },
  });
  const reissue = useMutation({
    mutationFn: (id: string) => api.post<{ enrolToken: string }>(`/staff/${id}/enrolment`),
    onSuccess: (r) => setLink(linkFor(r.enrolToken)),
  });
  const disable = useMutation({
    mutationFn: (id: string) => api.post(`/staff/${id}/disable`),
    onSuccess: refresh,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={UserCog} area="sky" title={t.title} />
      <form
        onSubmit={submit}
        aria-label={t.add}
        className="panel grid gap-3 p-5 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end"
      >
        <Field label={t.name}>
          <input
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field}
          />
        </Field>
        <Field label={t.email}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
        </Field>
        <Field label={t.role}>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className={field}
          >
            <option value="support">{en.roles.support}</option>
            <option value="owner">{en.roles.owner}</option>
          </select>
        </Field>
        <Button type="submit" disabled={add.isPending}>
          {t.create}
        </Button>
      </form>
      {link && (
        <div className="panel flex flex-col gap-2 p-5">
          <p className="text-caption text-ink">{t.link}</p>
          <code className="rounded-md bg-paper px-3 py-2 text-caption break-all text-ink">
            {link}
          </code>
        </div>
      )}
      <Notice error={add.error ?? reissue.error ?? disable.error} />
      <Loaded q={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <ul className="panel divide-y divide-line">
            {rows.map((s) => (
              <li key={s.staffId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink">{s.name}</span>
                  <span className="text-caption text-ink-muted">
                    {s.email} · {en.roles[s.role]}
                    {!s.enrolled && ` · ${t.notEnrolled}`}
                  </span>
                </span>
                {s.disabled ? (
                  <Chip tone="closed">{t.disabled}</Chip>
                ) : (
                  <>
                    <Button size="sm" variant="quiet" onClick={() => reissue.mutate(s.staffId)}>
                      {t.newLink}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => disable.mutate(s.staffId)}>
                      {t.disable}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </div>
  );
}
