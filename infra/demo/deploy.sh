#!/usr/bin/env bash
# From your machine (x86_64): builds the images here, ships them and the code to the demo server,
# and runs setup.sh there. A free-tier server has too little memory to build them itself.
#   bash infra/demo/deploy.sh <server-ip> <key.pem> <s3-bucket>
# S3 access comes from the server's IAM role. The first run carries the OpenAI key over from the
# hub's env files (never printed). SKIP_IMAGES=1 skips building and shipping images (config only).
set -euo pipefail
HOST=$1 KEY=$2 BUCKET=${3:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HUB=${HUB_DIR:-$HOME/Projects/campusverse/campus-verse-hub}
OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new)
SSH=(ssh "${OPTS[@]}" "ubuntu@$HOST")
IMAGES=(campusverse-demo-api campusverse-demo-worker campusverse-demo-migrate)

if [ -z "${SKIP_IMAGES:-}" ]; then
  echo "1/5 Building images (linux/amd64)…"
  for t in api worker migrate; do
    docker build --platform linux/amd64 --target "$t" -t "campusverse-demo-$t" "$ROOT"
  done
fi

echo "2/5 Copying the code (no dependencies, build output, env files or git history)…"
rsync -az --delete -e "ssh ${OPTS[*]}" \
  --exclude node_modules --exclude .next --exclude .turbo --exclude .git --exclude '.env' \
  --exclude '.env.*' --exclude test-results --exclude apps/web/e2e/screenshots \
  --exclude infra/demo/secrets.env --exclude .claude \
  "$ROOT/" "ubuntu@$HOST:campusverse-v2/"

echo "3/5 Preparing the server (Docker, swap)…"
"${SSH[@]}" 'bash campusverse-v2/infra/demo/setup.sh prepare'

if [ -z "${SKIP_IMAGES:-}" ]; then
  echo "4/5 Shipping the images (compressed; the first time takes a while)…"
  docker save "${IMAGES[@]}" | gzip -1 | "${SSH[@]}" 'gunzip | sudo docker load'
fi

if ! "${SSH[@]}" test -f campusverse-v2/infra/demo/.env; then
  [ -n "$BUCKET" ] || { echo "First deploy: give the S3 bucket name as the third argument."; exit 1; }
  pick() { grep -h "^$1=" "$HUB/.env" "$HUB/apps/api/.env" 2>/dev/null | head -1; }
  { echo "S3_BUCKET=$BUCKET"; pick OPENAI_API_KEY; } |
    "${SSH[@]}" 'umask 077; cat > campusverse-v2/infra/demo/secrets.env'
fi

echo "5/5 Starting…"
"${SSH[@]}" 'cd campusverse-v2/infra/demo && bash setup.sh'
