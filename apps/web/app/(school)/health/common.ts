'use client';

// Helpers shared by the Health Connect screens: dates in Indian time, error words and the
// student search (through the people module).
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';

const t = en.health;
export type Found = { personId: string; name: string; placement: string | null };

export const time = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
export const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
export const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';
export const count = (n: number | null) => (n === null ? t.fewer : n.toLocaleString('en-IN'));

/** Students of this school by name, through the people module's search. */
export function useStudentSearch(institutionId: string | null, text: string) {
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(text.trim()), 200);
    return () => clearTimeout(h);
  }, [text]);
  return useQuery({
    queryKey: ['health-find', institutionId, debounced],
    queryFn: () =>
      api.get<Found[]>(
        `/people/students?institutionId=${institutionId}&search=${encodeURIComponent(debounced)}`,
      ),
    enabled: !!institutionId && debounced.length >= 2,
  });
}
