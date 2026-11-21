'use client';

// The person's saved view (whole organisation, some campuses, or some institutions): what the
// overview, Students, Staff and the institution switcher cover. The API keeps it within the
// person's roles; every read is still checked on its own.
import type { MyView, ViewLevel } from '@campusverse/platform-organisation';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type { MyView, ViewLevel };

export function useView(enabled = true) {
  return useQuery({
    queryKey: ['view'],
    queryFn: () => api.get<MyView>('/organisation/view'),
    enabled,
    staleTime: 60_000,
  });
}

/** The campuses in the view, each with only the institutions the view covers. */
export function campusesIn(v: MyView): MyView['campuses'] {
  const inView = new Set(v.institutionIds);
  return v.campuses
    .map((c) => ({ ...c, institutions: c.institutions.filter((i) => inView.has(i.institutionId)) }))
    .filter(
      (c) => c.institutions.length > 0 || (v.level === 'campus' && v.ids.includes(c.campusId)),
    );
}
