# 0001 Toolchain versions

Date: 2026-11-04 · Status: accepted

## Decision

| Tool        | Pinned                             | Why                                                                                                           |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Node        | 22 LTS (`.nvmrc`)                  | Installed LTS line. Maintenance ends April 2027: move to 24 LTS before pilot.                                 |
| pnpm        | 11.9.0 (`packageManager`)          | Installed version. `minimumReleaseAge` set to 3 days.                                                         |
| TypeScript  | ~6.0                               | TypeScript 7 is out, but typescript-eslint 8 supports only `<6.1`. Upgrade once typescript-eslint supports 7. |
| @types/node | ^22                                | Matches the runtime.                                                                                          |
| Postgres    | `postgres:18` image (18.6 locally) | Matches RDS 18.x.                                                                                             |
| Redis       | `redis:7.2` image                  | Last fully open-source Redis line; keeps the ElastiCache Redis OSS / Valkey choice open.                      |

## Superseded

Local object storage was added in Milestone 5; see 0003.
