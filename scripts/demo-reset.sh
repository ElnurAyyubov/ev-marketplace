#!/usr/bin/env bash
# Tears down a demo run (DEMO_RUNNER_ADDENDUM.md section 5): wipes
# marketplace data via ResetMarketplaceData and kills every charger-sim
# scripts/demo-seed.sh launched. Users and token balances are untouched
# (ResetMarketplaceData never touches them), so demo-driver stays funded
# for the next seed run.
#
# Usage: ./scripts/demo-reset.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_DIR="${REPO_ROOT}/.run"

echo "==> resetting marketplace data"
(cd "${REPO_ROOT}/gateway" && npx tsx src/cli/demoSeed.ts reset)

if [[ -f "${RUN_DIR}/demo-sims.pid" ]]; then
  echo "==> stopping charger-sims"
  while read -r pid; do
    kill "${pid}" 2>/dev/null || true
  done <"${RUN_DIR}/demo-sims.pid"
  rm -f "${RUN_DIR}/demo-sims.pid"
fi

rm -f "${RUN_DIR}/demo-chargers.json"
echo "==> demo torn down"
