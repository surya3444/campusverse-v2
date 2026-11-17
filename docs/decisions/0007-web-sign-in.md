# 0007 Web sign-in and the API pass-through

Date: 2026-11-04 · Status: accepted

| Topic                     | Decision                                                                                                                                | Why                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Where tokens live         | httpOnly, SameSite=Strict cookies set by the web server (`app/session/*`). The browser never holds a token                              | A script injected into the page can't steal a session                   |
| How screens reach the API | `/api/v1/*` on the web server passes requests on with the session, refreshes an expired token once, and passes errors through unchanged | One origin for the browser; the API stays private behind the web server |
| CSRF                      | Every write must carry `x-requested-with: campusverse`; with SameSite=Strict cookies that closes cross-site requests                    | Simple and sufficient for a same-origin app                             |
| Sign-in endpoints         | Not reachable through the pass-through (`/api/v1/auth/*` returns 404 there)                                                             | Tokens travel only between the web server and the API                   |
| Client address            | The web server forwards `x-forwarded-for`; the API trusts it only from loopback                                                         | Per-IP OTP limits work, and nobody else can spoof an address            |
| Profiles                  | One profile is chosen automatically; otherwise the person picks, and the choice is checked against the API before it is stored          | Shared phones and people in several schools                             |
| After sign-in             | Only same-site paths are accepted for `next`                                                                                            | No open redirect                                                        |
| Web config                | `webEnv()` reads only `APP_ENV` and `API_URL`                                                                                           | The web server never holds database or Redis credentials                |
| Server state and forms    | TanStack Query for API data, React Hook Form with Zod for the structure form                                                            | The stack's rules                                                       |
| Browser tests             | `pnpm --filter @campusverse/api dev-session` signs up a school and prints a session; refused outside development                        | Tests start signed in without reading OTP codes from logs               |

**Known gaps:** the shell's sidebar still shows the synthetic school and user, and only `/setup` uses real data. The other school screens arrive with their modules. There's no "sign out" button in the shell yet.
