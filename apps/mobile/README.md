# apps/mobile

The Campusverse phone app (Expo SDK 58, React Native 0.88, expo-router). One app, by role: a guardian sees their children's day, messages and leave; a class teacher marks attendance, offline if need be. Someone who is both sees both. Spec: `docs/specs/PARENT_APP.md`.

## Run it on a phone

1. Start the backend from the repo root so the phone can reach it: `pnpm dev:infra`, then `API_HOST=0.0.0.0 pnpm dev`. (Without `API_HOST` the API listens on this Mac only.)
2. Find this Mac's address on your Wi-Fi (System Settings → Wi-Fi → Details), for example `192.168.1.20`.
3. `EXPO_PUBLIC_API_URL=http://192.168.1.20:4000 pnpm --filter @campusverse/mobile start`
4. Scan the QR code with Expo Go (Android) or the Camera app (iOS). Sign in with a guardian's or teacher's number; in development the code prints in the API's terminal (`[dev otp] …1234: 482913`).

If the phone can't reach the API, check that both are on the same Wi-Fi and the Mac's firewall allows port 4000. Use `API_HOST=0.0.0.0` only on a network you trust.

## What lives where

| File                                         | Does                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/api.ts`                                 | Calls the API as a device: Bearer token, `x-org-id`, `x-person-id`; refreshes once                                                                                                                                                                                                                               |
| `lib/store.ts` / `store.web.ts`              | Phone: expo-secure-store (Keychain / Keystore). Web build: sessionStorage                                                                                                                                                                                                                                        |
| `lib/queue.ts`, `queue-store.ts` / `.web.ts` | Offline attendance queue: SQLite on phones, localStorage on web; same protocol as the web app (decision 0009)                                                                                                                                                                                                    |
| `lib/messages.ts`                            | Every word, in English, Kannada, Telugu, Tamil, Hindi and Urdu. **Non-English text is a draft by Claude and needs native-speaker review before a pilot.** `messages.test.ts` checks every language has every key                                                                                                 |
| `lib/sign-in.tsx`                            | Phone OTP and the shared-phone profile picker                                                                                                                                                                                                                                                                    |
| `app/`                                       | Screens: home (with the teacher’s lessons and what’s left of their leave), message, leave (a child’s), staff leave (one’s own, `staff/leave`), homework (a child’s, `parent/homework`; a teacher sets it with a camera photo and writes the diary, `staff/homework`), fees, timetable, teacher marking, settings |

## The web build is for tests only

`pnpm --filter @campusverse/mobile export:web` builds `dist/`, and `node scripts/serve-web.mjs 8081` serves it with `/api` forwarded to the local API. Playwright uses it (`apps/web/e2e/parent-app.spec.ts`). It keeps the session in sessionStorage, so it is not a product for parents.

## Not yet

Push notifications on the device (needs an FCM project and `expo-notifications`), store builds (EAS, Google Play and Apple developer accounts), Maestro device tests, Noto fonts bundled for regional scripts, right-to-left on native without an app restart, a date picker for leave, and payment.
