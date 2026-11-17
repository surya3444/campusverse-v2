#!/usr/bin/env bash
# Timed restore check (guide: monthly, in an isolated environment). Restores the newest automated
# snapshot to a throwaway RDS instance, runs the restore check task against it, records how long
# it took (CloudWatch metric CampusVerse/RestoreMinutes) and removes the throwaway instance.
# The source database is never touched.
#
# Needs AWS credentials for the environment and:
#   CLUSTER  DB_INSTANCE  DB_SUBNET_GROUP  DB_SG
set -euo pipefail
: "${CLUSTER:?}" "${DB_INSTANCE:?}" "${DB_SUBNET_GROUP:?}" "${DB_SG:?}"

started=$(date +%s)
TARGET="cv-restore-check-$(date -u +%Y%m%d%H%M)"

# shellcheck disable=SC2016  # the backticks are JMESPath literals, not shell
SNAPSHOT=$(aws rds describe-db-snapshots --db-instance-identifier "$DB_INSTANCE" \
  --snapshot-type automated \
  --query 'reverse(sort_by(DBSnapshots[?Status==`available`], &SnapshotCreateTime))[0].DBSnapshotIdentifier' \
  --output text)
[ "$SNAPSHOT" != "None" ] || { echo "No automated snapshot found" >&2; exit 1; }
echo "Restoring $SNAPSHOT to $TARGET"

# Only the throwaway instance this run created is removed, whatever happens.
cleanup() {
  aws rds delete-db-instance --db-instance-identifier "$TARGET" \
    --skip-final-snapshot --delete-automated-backups >/dev/null 2>&1 || true
}
trap cleanup EXIT

aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier "$TARGET" --db-snapshot-identifier "$SNAPSHOT" \
  --db-subnet-group-name "$DB_SUBNET_GROUP" --vpc-security-group-ids "$DB_SG" \
  --db-instance-class db.t4g.medium --no-multi-az --no-publicly-accessible \
  --no-deletion-protection --tags Key=purpose,Value=restore-check >/dev/null
aws rds wait db-instance-available --db-instance-identifier "$TARGET"
restored=$(date +%s)
HOST=$(aws rds describe-db-instances --db-instance-identifier "$TARGET" \
  --query 'DBInstances[0].Endpoint.Address' --output text)

# The check runs inside the network with the migrator's login, pointed at the copy.
NET=$(aws ecs describe-services --cluster "$CLUSTER" --services api \
  --query 'services[0].networkConfiguration' --output json)
OVERRIDES=$(jq -n --arg host "$HOST" '{containerOverrides: [{
  name: "migrate",
  command: ["--import", "tsx", "scripts/restore-check.ts"],
  environment: [{name: "RESTORE_HOST", value: $host}]
}]}')
TASK=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "$CLUSTER-migrate" --network-configuration "$NET" \
  --overrides "$OVERRIDES" --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].containers[0].exitCode' --output text)
finished=$(date +%s)

minutes=$(( (finished - started + 59) / 60 ))
aws cloudwatch put-metric-data --namespace CampusVerse --metric-name RestoreMinutes \
  --dimensions Cluster="$CLUSTER" --value "$minutes" --unit None
summary="Restore check of $SNAPSHOT: restore $(( (restored - started) / 60 )) min, total $minutes min, check exit $CODE"
echo "$summary"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$summary" >>"$GITHUB_STEP_SUMMARY"
[ "$CODE" = "0" ]
