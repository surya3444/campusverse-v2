// The one place the app reads build-time config. Expo inlines EXPO_PUBLIC_* at build time, so this
// must be a literal process.env access. Empty means "same origin": the web test build is served
// behind a proxy to the API.
// eslint-disable-next-line no-restricted-syntax
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
