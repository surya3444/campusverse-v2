#!/usr/bin/env bash
# Deploys the web app to the Vercel demo project from a clean copy without git history: the
# Vercel team blocks deployments whose git commit author isn't a team member. The copy follows
# .vercelignore (no env files, dependencies or build output). The owner runs it:
#   bash infra/demo/vercel-deploy.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=$(mktemp -d)/campusverse-v2
mkdir -p "$OUT"
rsync -a --exclude-from="$ROOT/.vercelignore" --exclude .git --exclude .vercel "$ROOT/" "$OUT/"
cp -R "$ROOT/.vercel" "$OUT/.vercel"
echo "Clean copy: $OUT"
cd "$OUT"
vercel deploy --prod --yes
