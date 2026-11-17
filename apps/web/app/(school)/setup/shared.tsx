'use client';

// Types, queries and helpers shared by the wizard's steps.
import type {
  ImportPreview,
  InvitePreview,
  ReadinessCheck,
  SetupOverview,
} from '@campusverse/school-setup';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';

export type { ImportPreview, InvitePreview, ReadinessCheck, SetupOverview };
export type Readiness = { ready: boolean; checks: ReadinessCheck[] };

export const keys = {
  institutions: ['institutions'] as const,
  overview: (id: string) => ['overview', id] as const,
  readiness: (id: string) => ['readiness', id] as const,
  invites: (id: string) => ['invites', id] as const,
  batch: (id: string) => ['batch', id] as const,
};

export const useOverview = (id: string) =>
  useQuery({
    queryKey: keys.overview(id),
    queryFn: () => api.get<SetupOverview>(`/school/setup/${id}`),
  });

export const useReadiness = (id: string) =>
  useQuery({
    queryKey: keys.readiness(id),
    queryFn: () => api.get<Readiness>(`/school/setup/${id}/readiness`),
  });

/** After any setup write, everything that summarises the school is stale. */
export function useRefreshSetup(id: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.overview(id) }),
      qc.invalidateQueries({ queryKey: keys.readiness(id) }),
      qc.invalidateQueries({ queryKey: keys.invites(id) }),
    ]);
}

/** The message for a failure, from the language file by its code. */
export function failureText(e: unknown): string {
  const code = e instanceof ApiFailure ? e.code : 'error';
  return en.setup.errors[code] ?? en.setup.errors.error ?? '';
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-md bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink"
    >
      {failureText(error)}
    </p>
  );
}

const ddmmyyyy = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
export const formatDate = (iso: string) => ddmmyyyy.format(new Date(`${iso}T00:00:00Z`));
