---
name: new-module
description: Create a Campus Verse module with contract, domain, use cases, migrations, tests and docs.
---

1. Read docs/BUILD_GUIDE.md and the module spec in docs/specs/. No spec means stop and ask.
2. Decide whether the module is shared, school-only or independent, and place it under modules/<kind>/<name>/.
3. Write contract.ts first: public API, events, permissions.
4. Write domain tests before domain code. domain/ stays framework-free.
5. Add migrations with RLS and FORCE RLS (use the db-migration skill).
6. Add permissions, audit, outbox events and language keys.
7. Add API, UI states and an end-to-end test.
8. Update the module README and run pnpm verify. Show the output.
