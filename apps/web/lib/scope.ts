'use client';

// The institution the person is working in (the scope switcher), remembered on this device.
// Every screen reads it through useInstitution(); changing it re-renders them all.
import { useSyncExternalStore } from 'react';

const KEY = 'cv.institution';
const EVENT = 'cv-scope';

const read = (): string | null => {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export function chooseInstitution(id: string) {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // private mode: the choice lasts this page only
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useChosenInstitution(): string | null {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener(EVENT, notify);
      window.addEventListener('storage', notify);
      return () => {
        window.removeEventListener(EVENT, notify);
        window.removeEventListener('storage', notify);
      };
    },
    read,
    () => null,
  );
}
