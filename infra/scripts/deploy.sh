#!/usr/bin/env bash
# Deploys one image tag to one environment: new task definition revisions, the migration task
# (services move only if it succeeds), rolling service updates, then smoke tests.
# ECS rolls back by itself when new tasks fail or the 5xx alarm fires (deployment alarms).
#
# Needs AWS credentials for the environment and:
#   CLUSTER   ECS cluster (campusverse-test or campusverse-live)
#   REGISTRY  ECR registry host (<account>.dkr.ecr.ap-south-1.amazonaws.com)
#   TAG       image tag (the git commit)
#   APP_HOST API_HOST ADMIN_HOST   public host names for the smoke tests
#   SMOKE_ADMIN=0   skip the admin portal check where it is limited to office networks
set -euo pipefail
: "${CLUSTER:?}" "${REGISTRY:?}" "${TAG:?}" "${APP_HOST:?}" "${API_HOST:?}" "${ADMIN_HOST:?}"

# A new revision of a task definition family with the image replaced.
revise() {
  local family=$1 service=$2
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json |
    jq --arg image "$REGISTRY/campusverse/$service:$TAG" '
      .containerDefinitions[0].image = $image
      | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
            .registeredAt, .registeredBy, .deregisteredAt)' >"/tmp/td-$service.json"
  aws ecs register-task-definition --cli-input-json "file:///tmp/td-$service.json" \
    --query taskDefinition.taskDefinitionArn --output text
}

echo "Deploying $TAG to $CLUSTER"
declare -A ARN
for s in migrate api worker web admin; do
  ARN[$s]=$(revise "$CLUSTER-$s" "$s")
  echo "  $s -> ${ARN[$s]##*/}"
done

# The migration runs in the API's network, with only the migrator's login.
NET=$(aws ecs describe-services --cluster "$CLUSTER" --services api \
  --query 'services[0].networkConfiguration' --output json)
TASK=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "${ARN[migrate]}" --network-configuration "$NET" \
  --query 'tasks[0].taskArn' --output text)
echo "Migrating ($TASK)"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$CODE" != "0" ]; then
  echo "Migration failed (exit $CODE). Services were not changed." >&2
  exit 1
fi

for s in api worker web admin; do
  aws ecs update-service --cluster "$CLUSTER" --service "$s" \
    --task-definition "${ARN[$s]}" --query 'service.serviceName' --output text >/dev/null
done
echo "Waiting for services to settle"
aws ecs wait services-stable --cluster "$CLUSTER" --services api worker web admin

# Smoke tests: the database answers, pages load, the QR check works without a session, and the
# admin API is not reachable from the internet.
check() {
  local want=$1 url=$2 got
  got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url")
  if [ "$got" != "$want" ]; then
    echo "Smoke test failed: $url answered $got, expected $want" >&2
    exit 1
  fi
  echo "  ok $got $url"
}
echo "Smoke tests"
check 200 "https://$API_HOST/api/v1/health/ready"
check 200 "https://$APP_HOST/login"
check 200 "https://$APP_HOST/verify/NOTACODE"
check 404 "https://$API_HOST/api/v1/admin/me"
if [ "${SMOKE_ADMIN:-1}" = "1" ]; then check 200 "https://$ADMIN_HOST/sign-in"; fi
echo "Deployed $TAG"
