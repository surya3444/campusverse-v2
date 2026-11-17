# 0002 Where SCHOOLS_RELEASE.md and BUILD_GUIDE.md disagree

Date: 2026-11-04 · Status: accepted

The build guide says its decisions win where documents conflict. Applied:

| Topic             | Spec says                      | Decision                                                                                                  |
| ----------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| AI assistant name | Mitra                          | **Verse AI** everywhere                                                                                   |
| Environments      | local, CI, staging, production | **development, test, production**. CI is a pipeline, not an environment. "Staging" in the spec means test |
| Queue             | SQS or BullMQ                  | **BullMQ** on Redis, fed by a Postgres outbox                                                             |

Everything else in the spec (scope stages, state packs as data, CBSE first, payroll deferred, Health Connect minimal) stands as written, pending the open decisions listed in the spec.
