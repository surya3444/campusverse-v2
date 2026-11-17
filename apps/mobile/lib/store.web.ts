// The web build exists for development and browser tests only (decision 0010): the session lives
// in sessionStorage and ends with the tab. Real parents use the phone app's secure store.
const ok = () => typeof sessionStorage !== 'undefined';

export const store = {
  get: async (key: string) => (ok() ? sessionStorage.getItem(key) : null),
  set: async (key: string, value: string) => {
    if (ok()) sessionStorage.setItem(key, value);
  },
  remove: async (key: string) => {
    if (ok()) sessionStorage.removeItem(key);
  },
};
