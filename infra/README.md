# Infrastructure (AWS Mumbai)

Terraform for the **test** and **live** (production) environments, each in its own AWS account in `ap-south-1`, built from the same modules so test rehearses live. Decision: `docs/decisions/0016-environments.md`.

```text
infra/
  bootstrap/            once per account: state bucket, GitHub deploy role (OIDC)
  modules/
    environment/        one whole environment, composed of:
    network/            VPC over two zones, NAT, security groups
    data/               RDS PostgreSQL 18, ElastiCache Valkey 8, documents bucket, KMS key
    app/                ECR, ECS Fargate services (api, worker, web, admin) + migrate task,
                        load balancer with WAF, secrets (shells), DNS and certificate
    observability/      alarms by email, monthly budget
    backup/             AWS Backup daily, copies to Hyderabad (live)
  envs/test/            test sizes, deployed automatically after merges to main
  envs/live/            live sizes; the owner plans and applies every change
  scripts/deploy.sh     new revisions, migration task, rolling update, smoke tests
  scripts/restore-check.sh   timed snapshot restore to a throwaway instance
```

|              | Test                                         | Live                                                     |
| ------------ | -------------------------------------------- | -------------------------------------------------------- |
| Hosts        | `test.`, `api.test.`, `admin.test.` + domain | `app.`, `api.`, `admin.` + domain                        |
| Database     | db.t4g.medium, single zone, 3-day PITR       | db.m7g.large, Multi-AZ, 35-day PITR, deletion protection |
| Valkey       | 1 node                                       | 2 nodes, failover                                        |
| Services     | 1 of each                                    | api 2, worker 2, web 2, admin 1                          |
| Backups      | 7 days                                       | 35 days, copied to ap-south-2                            |
| Deploy       | automatic after CI on main                   | `Promote to live` workflow, owner approves               |
| Budget alarm | $150                                         | $600                                                     |

**Who can reach what:** the load balancer is the only public entry (WAF: AWS managed rules and 2,000 requests per 5 minutes per address). `/api/v1/admin*` is refused publicly; the admin portal reaches it inside the network (ECS Service Connect `http://api:4000`). The live admin portal can be limited to office networks (`admin_cidrs`). Database and Valkey accept only the app's security group; nothing has a public address.

**Secrets:** Terraform creates empty secrets only, so values never enter state. Tasks won't start until their secrets have values. Telemetry stays in CloudWatch (no student data leaves the account); logs are kept a year (CERT-In requires 180 days).

## First-time setup (owner)

Claude Code has no AWS credentials. Run these with your own administrator profile.

1. **Accounts and domain.** Two AWS accounts (test, live) and a Route 53 hosted zone for the domain (or delegated subdomains in each account).
2. **Bootstrap each account:**
   `terraform -chdir=infra/bootstrap init && terraform -chdir=infra/bootstrap apply -var environment=test -var github_repo=OWNER/REPO`, then the same with `environment=live`. Note `state_bucket` and `deploy_role_arn`.
3. **Variables.** Create `infra/envs/test/test.tfvars` (git-ignored):
   `zone_id = "Z…"`, `domain = "campusverse.app"`, `alert_email = "…"`, `message_allowlist = "+91…,+91…"` (testers' phones). Live likewise, plus `admin_cidrs` and later `optional_secrets = ["razorpay", "anthropic"]` (or `"openai"`; set `VERSE_PROVIDER` to choose when both exist).
4. **Apply test:** `terraform -chdir=infra/envs/test init -backend-config="bucket=<state_bucket>"`, then `apply -var-file=test.tfvars`. Confirm the alert email subscription.
5. **Database logins.** Start one api task (it will wait for secrets), or use ECS Exec on it once running, and in that logged session run `packages/db/scripts/bootstrap-roles.ts` with the RDS master login from Secrets Manager (`db_master_secret_arn` output) and two new long passwords. **Check:** RDS must accept `BYPASSRLS` for `cv_migrator` (cross-tenant backfills in migrations need it). If it is refused, stop and decide before running migrations.
6. **Secrets.** Put values into `campusverse-test/database-url` (`postgres://cv_app:…@<db_endpoint>:5432/campusverse?sslmode=require`), `migration-database-url` (cv_migrator), `auth-pepper` (32+ random bytes), `field-keys` (`1:<base64 of 32 random bytes>`).
7. **GitHub.** Environments `test` and `production` (production: required reviewer = you). Repository variables: `TEST_DEPLOY_ROLE_ARN`, `TEST_REGISTRY` (`<account>.dkr.ecr.ap-south-1.amazonaws.com`), `TEST_DOMAIN`, `TEST_DB_SUBNET_GROUP` and `TEST_DB_SG` (outputs), and later the `LIVE_*` ones.
8. **First deploy:** merge to main (or re-run the last CI). `Deploy to test` builds, migrates, rolls out and smoke-tests. Then run `Restore check` once by hand and note the time.
9. **Live:** repeat 3–7 for live with `envs/live`, review the plan line by line, apply. Promote a tested commit with the `Promote to live` workflow.

## Day to day

- **Deploy:** merging to main deploys to test. To release, run `Promote to live` with a commit SHA that is in test; you approve it in GitHub.
- **Rollback:** ECS rolls back by itself if new tasks fail or the 5xx alarm fires. To go back on purpose, promote the previous SHA. Migrations are expand-and-contract, so the previous image still works with the new schema.
- **Database access (live):** only in an ECS Exec session on an api task, which is logged to `/campusverse/production/exec-sessions`; grant the IAM permission for the session and remove it after.
- **Restore check:** monthly in test (workflow). For live, run `infra/scripts/restore-check.sh` yourself with live credentials and record the time in `docs/runbooks/restore.md`.
- **Locally:** `pnpm db:restore-rehearsal` dumps the development database, restores it into a throwaway Postgres and checks it, timed.
