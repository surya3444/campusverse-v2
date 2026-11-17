# platform/permissions

One `can()` for the whole product. A decision combines four inputs:

| Input        | Source                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Role         | `role_grant` rows for the person's roles, from `role_assignment` and active `staff_duty`                         |
| Scope        | Grant scope (organisation, campus, institution) against the resource's `place`                                   |
| Relationship | `self`, or an active, unrestricted, login-enabled `guardian_link`, optionally with a flag such as `is_fee_payer` |
| State        | `stateAllows` supplied by the owning module, such as an open marks window                                        |

Deny reasons: `other_tenant`, `no_grant`, `out_of_scope`, `no_relationship`, `state_closed`.

**Cache:** snapshots live in Redis under `perm:{org}:{person}:{IST date}:{permission_version}` for 15 minutes. A statement trigger bumps `organisation.permission_version` on any change to grants, assignments, duties or guardian links, so changes apply at once. If Redis is down, snapshots load from Postgres.

**Case grants:** `evaluate` allows a permission about one person when a running case grant names it (`Decision.case` carries the grant id), whatever the roles say; never across tenants or against closed state. The snapshot loads running grants; the evaluation checks the expiry against the clock as well. Granting or ending one bumps the permission version, so cached snapshots go stale at once.

**Owned tables:** `role`, `role_grant`, `role_assignment`, `staff_duty` (migration 0002); `access_case_grant` (migration 0062; only ending is an update).

**Events:** none yet. `role changed` arrives with the outbox in Milestone 5.

**Tests:** `domain/evaluate.test.ts` (pure rules), `tests/can.db.test.ts` (permission matrix on real Postgres and Redis).
