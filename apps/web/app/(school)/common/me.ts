'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';

export type Me = {
  personId: string;
  name: string;
  orgName: string;
  roles: string[];
  photoFileId: string | null;
  /** Plain permissions held anywhere today: for showing screens; the server checks each request. */
  permissions: string[];
};

/** `enabled` false (signed out, e.g. the design-review pages): no request, nothing held. */
export function useMe(enabled = true) {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/people/me'), enabled });
  const can = (permission: string) => me.data?.permissions.includes(permission) ?? false;
  return { ...me, can };
}
