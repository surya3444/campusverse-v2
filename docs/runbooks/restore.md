# Restore runbook

## Kinds of restore

| Situation                                                 | Use                                                           | Notes                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| A bad change in the last days (data deleted or corrupted) | RDS point-in-time restore to a **new** instance, then repair  | Live keeps 35 days, test 3. Never restore over the running instance |
| The instance or zone is lost                              | Multi-AZ failover (automatic, live only)                      | Minutes                                                             |
| The region or account is unusable                         | AWS Backup copy in Hyderabad (ap-south-2), restored there     | Live only; data stays in India                                      |
| A document was overwritten or deleted                     | S3 object versions (90 days) or the AWS Backup recovery point |                                                                     |

## Restoring the database (point in time)

1. Pick the time just before the problem (IST to UTC: minus 5:30).
2. `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier campusverse-live --target-db-instance-identifier campusverse-live-restore-<date> --restore-time <UTC> --db-subnet-group-name campusverse-live --vpc-security-group-ids <db sg> --no-publicly-accessible`
3. Run the restore check against it: `infra/scripts/restore-check.sh` does this for snapshots; for a point-in-time copy, run the migrate task with the command override `--import tsx scripts/restore-check.ts` (the image runs node) and `RESTORE_HOST=<new endpoint>`.
4. Decide: copy the repaired rows back with a reviewed script in a logged ECS Exec session, or switch the `database-url` secrets to the new instance and redeploy (`Promote to live` with the running SHA).
5. Write down what happened, the times and the data affected. If personal data was affected, start the breach workflow (6-hour and 72-hour clocks).

## Timed restore checks

The monthly `Restore check` workflow (test) and the owner's live runs record the total minutes from start to a checked copy (`CampusVerse/RestoreMinutes`). Record live results here.

| Date       | Environment                                                 | Snapshot   | Restore minutes | Total minutes | Result                        |
| ---------- | ----------------------------------------------------------- | ---------- | --------------- | ------------- | ----------------------------- |
| 2026-11-05 | development rehearsal (`pnpm db:restore-rehearsal`, 4.6 MB) | local dump | 0.03            | 0.08 (5 s)    | ok, all 13 migrations present |
