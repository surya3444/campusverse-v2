#!/usr/bin/env bash
# Local backup-and-restore rehearsal, timed. Dumps the development database, restores it into a
# separate throwaway Postgres (isolated, like the restored RDS instance in AWS), runs the restore
# check against it, then stops the throwaway server. The development database is only read.
# The AWS version (snapshot restore to a throwaway RDS instance) is infra/scripts/restore-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

PG=$(docker compose ps -q postgres)
[ -n "$PG" ] || { echo "Postgres isn't running: pnpm dev:infra" >&2; exit 1; }
SCRATCH=cv-restore-rehearsal
PORT=5434
DUMP=$(mktemp -d)/campusverse.dump
now() { date +%s; }
cleanup() { docker stop "$SCRATCH" >/dev/null 2>&1 || true; rm -f "$DUMP"; }
trap cleanup EXIT

t0=$(now)
docker exec "$PG" pg_dump -U campusverse -Fc campusverse > "$DUMP"
t1=$(now)

docker run -d --rm --name "$SCRATCH" -p "$PORT:5432" \
  -e POSTGRES_USER=campusverse -e POSTGRES_PASSWORD=campusverse -e POSTGRES_DB=campusverse \
  -v "$PWD/packages/db/sql/roles.local.sql:/docker-entrypoint-initdb.d/roles.sql:ro" \
  postgres:18 >/dev/null
until docker exec "$SCRATCH" pg_isready -U campusverse -d campusverse -q 2>/dev/null &&
  docker exec "$SCRATCH" psql -U campusverse -d campusverse -qAtc 'select 1' >/dev/null 2>&1; do
  sleep 0.5
done
t2=$(now)
docker exec -i "$SCRATCH" pg_restore -U campusverse -d campusverse --exit-on-error < "$DUMP"
t3=$(now)

RESTORE_HOST=localhost RESTORE_PORT=$PORT pnpm --silent --filter @campusverse/db restore-check
t4=$(now)

echo "dump $(du -h "$DUMP" | cut -f1): backup $((t1 - t0)) s, empty server $((t2 - t1)) s," \
  "restore $((t3 - t2)) s, check $((t4 - t3)) s; backup to verified restore $((t1 - t0 + t4 - t2)) s"
