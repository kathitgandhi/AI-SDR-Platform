#!/usr/bin/env bash
#
# AI SDR Platform — one-shot rebuild + verify
# Run from EC2:  bash scripts/rebuild-and-test.sh
#
# Does the full "make it actually live" sequence with NO guesswork:
#   1. git pull (latest main)
#   2. rebuild api + workers from scratch (--no-cache)
#   3. force-recreate the containers (picks up new image + .env)
#   4. wait for /health to go green
#   5. print the running image build time so you can SEE it's fresh
#   6. run the E2E smoke test
#
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
say() { echo -e "${BLUE}▶ $1${NC}"; }

say "1/6  Pulling latest main…"
git pull --ff-only || { echo -e "${RED}git pull failed — resolve manually${NC}"; exit 1; }

say "2/6  Rebuilding api + workers (--no-cache, this takes a few min)…"
sudo docker compose build --no-cache api call-workers pipeline-workers

say "3/6  Force-recreating containers…"
sudo docker compose up -d --force-recreate api call-workers pipeline-workers

say "4/6  Waiting for API /health…"
for i in $(seq 1 30); do
  if curl -fs http://localhost:3000/health >/dev/null 2>&1; then
    echo -e "   ${GREEN}health OK after ${i}s${NC}"
    break
  fi
  sleep 1
  [[ $i == 30 ]] && echo -e "   ${RED}health never came up — check: sudo docker compose logs api${NC}"
done

say "5/6  Confirming the running image is FRESH (build timestamp)…"
img=$(sudo docker compose images api 2>/dev/null | awk 'NR==2{print $4":"$5}')
created=$(sudo docker inspect -f '{{.Created}}' "$(sudo docker compose ps -q api)" 2>/dev/null)
echo "   api image: ${img:-unknown}"
echo "   container created: ${created:-unknown}"
echo "   (if 'created' is more than a few minutes ago, the rebuild did NOT take effect)"

say "6/6  Running E2E smoke test…"
echo
bash scripts/e2e-smoke-test.sh
