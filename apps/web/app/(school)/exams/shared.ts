'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';

export const t = en.exams;
export const examError = (e: unknown): string =>
  t.errors[e instanceof ApiFailure ? e.code : 'error'] ?? t.errors.error ?? '';
export const field =
  'h-9 rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';
export const EXAM_CHIP: Record<string, string> = {
  marks_open: 'bg-signal-warn-tint text-signal-warn-ink',
  marks_locked: 'bg-navy-50 text-navy-700',
  published: 'bg-signal-go-tint text-signal-go-ink',
  cancelled: 'bg-paper text-ink-faint',
};

export type YearsAndClasses = {
  years: { yearId: string; label: string; starts: string; ends: string; status: string }[];
  classes: { classId: string; code: string; name: string; sequence: number }[];
};

export function useYears(institutionId: string | undefined) {
  return useQuery({
    queryKey: ['exam-years', institutionId],
    queryFn: () => api.get<YearsAndClasses>(`/school/exams/institution/${institutionId}/years`),
    enabled: !!institutionId,
  });
}
