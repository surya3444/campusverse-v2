---
name: release-check
description: Manual pre-release review before promoting a build from test to production.
disable-model-invocation: true
---

1. Confirm pnpm verify, RLS tests and security scans passed on the exact commit.
2. Confirm migrations ran on test, with timings, and are expand-only or have a contract plan.
3. Confirm smoke tests and critical journeys passed on test.
4. List changes touching money, permissions, migrations or child data, and confirm a human reviewed each.
5. Confirm the rollback path and the last backup restore time.
6. Report findings. Do not deploy. A human approves production.
