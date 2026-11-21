'use client';

import type { MyProfile } from '@campusverse/people-records';
import { Button, Pill, Section, SkeletonRows, StatePanel } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { RecordStamp } from '../../common/activity';
import { fieldInput } from '../../common/custom-fields';
import { ImageUpload } from '../../common/image-upload';
import { useMe } from '../../common/me';
import { SettingsFrame } from '../frame';
import { TwoStep } from './two-step';

const t = en.myProfile;

export function ProfileView() {
  const qc = useQueryClient();
  const me = useMe();
  const profile = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => api.get<MyProfile>('/people/me/profile'),
  });
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState('en');
  useEffect(() => {
    if (!profile.data) return;
    setEmail(profile.data.email ?? '');
    setLanguage(profile.data.preferredLanguage);
  }, [profile.data]);
  const save = useMutation({
    mutationFn: () =>
      api.post('/people/me/profile', { email: email.trim() || null, preferredLanguage: language }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-profile'] });
      void qc.invalidateQueries({ queryKey: ['stamps'] });
    },
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['my-profile'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const p = profile.data;
  const dirty = !!p && ((p.email ?? '') !== email.trim() || p.preferredLanguage !== language);

  return (
    <SettingsFrame title={t.title} lead={t.lead}>
      {profile.isPending ? (
        <SkeletonRows rows={4} label={en.states.loading.title} />
      ) : profile.isError || !p ? (
        <StatePanel kind="error" title={en.states.error.title} />
      ) : (
        <form onSubmit={submit} aria-label={t.title}>
          <Section
            title={p.name}
            footer={
              <>
                <span role="status" className="flex-1">
                  {save.isError
                    ? save.error instanceof ApiFailure && save.error.code === 'invalid_input'
                      ? en.customFields.problems.invalid
                      : en.organisationAdmin.errors.error
                    : save.isSuccess && !dirty
                      ? t.saved
                      : ''}
                </span>
                <Button type="submit" disabled={!dirty || save.isPending}>
                  {t.save}
                </Button>
              </>
            }
          >
            <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
              <ImageUpload
                label={t.photo}
                name={p.name}
                src="/api/v1/people/me/photo"
                currentFileId={p.photoFileId}
                uploadPath="/people/me/photo"
                removePath={p.photoFileId ? '/people/me/photo/remove' : undefined}
                onChanged={refresh}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <ReadOnly label={t.name} value={p.name} hint={t.nameHint} />
                <ReadOnly label={t.phone} value={p.phone ?? '—'} hint={t.phoneHint} />
                <label className="flex flex-col gap-1.5">
                  <span className="text-caption font-medium text-ink">{t.email}</span>
                  <input
                    type="email"
                    maxLength={200}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={fieldInput}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-caption font-medium text-ink">{t.language}</span>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className={fieldInput}
                  >
                    {Object.entries(t.languages).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                {me.data && me.data.roles.length > 0 && (
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className="text-caption font-medium text-ink">{t.roles}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {me.data.roles.map((r) => (
                        <Pill key={r}>{r}</Pill>
                      ))}
                    </span>
                  </div>
                )}
                <RecordStamp id={p.personId} className="sm:col-span-2" />
              </div>
            </div>
          </Section>
        </form>
      )}
      <TwoStep />
    </SettingsFrame>
  );
}

function ReadOnly({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-medium text-ink">{label}</span>
      <span className="flex h-10 items-center rounded-lg bg-paper px-3 text-body text-ink">
        {value}
      </span>
      <span className="text-caption text-ink-muted">{hint}</span>
    </div>
  );
}
