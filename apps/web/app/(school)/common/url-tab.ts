'use client';

// A screen's tab kept in the address (?tab=…), so the sidebar's module links open the right tab,
// the back button works, and a tab can be shared. Unknown values fall back to the default.
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export function useUrlTab<T extends string>(
  tabs: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const params = useSearchParams();
  const path = usePathname();
  const asked = params.get('tab') as T | null;
  const fromUrl = asked && tabs.includes(asked) ? asked : fallback;
  // Switches at once on a click; follows the address when it changes (a sidebar link, back).
  const [tab, setTab] = useState<T>(fromUrl);
  useEffect(() => setTab(fromUrl), [fromUrl]);
  const set = useCallback(
    (next: T) => {
      setTab(next);
      const p = new URLSearchParams(params.toString());
      p.set('tab', next);
      // The history API, not a router navigation: no reload of the page's data.
      window.history.replaceState(null, '', `${path}?${p.toString()}`);
    },
    [params, path],
  );
  return [tab, set];
}
