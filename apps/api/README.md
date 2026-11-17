# apps/api

NestJS on Fastify. `pnpm dev` serves `http://127.0.0.1:4000/api/v1`.

- `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `GET /auth/profiles`, `POST /auth/logout`
- `/school/setup/...`: structure preview and apply, import upload/preview, commit (202), status, undo, invites preview and send (202), readiness, templates

Every request after sign-in sends `Authorization: Bearer <access token>`, `x-org-id` and `x-person-id` for the chosen profile. Errors share one shape (`code`, `message`, `field`, `details`, `requestId`, `retryable`).

Tests: `tests/api.db.test.ts` drives the whole setup over HTTP.
