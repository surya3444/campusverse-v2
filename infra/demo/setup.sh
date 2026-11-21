#!/usr/bin/env bash
# On the demo server (Ubuntu 24.04), from infra/demo. deploy.sh runs it twice:
#   bash setup.sh prepare   # Docker and 2 GB of swap (free-tier servers have 1-2 GB of memory)
#   bash setup.sh           # secrets on first run, database logins, migrations, start, health check
# Images are loaded beforehand by deploy.sh; nothing is built here.
set -euo pipefail
cd "$(dirname "$0")"
DOCKER=docker
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

if [ "${1:-}" = prepare ]; then
  command -v docker >/dev/null || curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi
  echo "Server prepared."
  exit 0
fi

rand() { openssl rand -base64 "$1" | tr -d '\n'; }
hex() { openssl rand -hex "$1"; }
if [ ! -f .env ]; then
  umask 077
  {
    echo "PG_MASTER_PASSWORD=$(hex 24)"
    echo "CV_MIGRATOR_PASSWORD=$(hex 24)"
    echo "CV_APP_PASSWORD=$(hex 24)"
    echo "AUTH_PEPPER=$(rand 48)"
    echo "FIELD_KEYS=1:$(rand 32)"
    echo "HEALTH_KEYS=1:$(rand 32)"
  } > .env
  cat secrets.env >> .env 2>/dev/null || true
  rm -f secrets.env
  echo "Wrote .env with new secrets. Keep a copy somewhere safe."
fi
for k in S3_BUCKET; do
  grep -q "^$k=." .env || { echo "Missing $k in .env"; exit 1; }
done

$DOCKER compose up -d postgres valkey
$DOCKER compose run --rm roles
$DOCKER compose run --rm migrate
$DOCKER compose up -d --force-recreate api worker caddy
# The API image has no shell; ask from the Caddy container.
for _ in $(seq 1 45); do
  if $DOCKER compose exec -T caddy wget -qO- http://api:4000/api/v1/health/ready >/dev/null 2>&1; then
    echo "API is ready: https://api.demo-v2.campusverse.app/api/v1/health"
    exit 0
  fi
  sleep 2
done
echo "API did not become ready; see: docker compose logs api"
exit 1
