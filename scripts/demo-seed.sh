#!/usr/bin/env bash
# Seeds the demo topology (DEMO_RUNNER_ADDENDUM.md section 5): resets
# marketplace data, registers N demo providers + chargers along the
# Istanbul -> Ankara corridor, enrolls and launches one charger-sim per
# charger, and enrolls + funds the demo driver identities.
#
# Usage:
#   ./scripts/demo-seed.sh [stopCount]   # default 3
#
# Then, in another terminal:
#   ENABLE_DEV_DEMO=1 ./scripts/run-user.sh demo-driver 3099 5199
#
# Prerequisites (same as every other script here -- see root README
# "Identities" section):
#   - Fabric network up, marketplace chaincode deployed.
#   - 'admin' and 'minteradmin' identities already enrolled under
#     gateway/identities/ (minteradmin is Constants.ADMIN_IDENTITY --
#     ResetMarketplaceData and Mint are gated to it).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

STOP_COUNT="${1:-3}"
BASE_ADMIN_PORT=9001
DRIVER_BALANCE=100000

IDENTITIES_DIR="${REPO_ROOT}/gateway/identities"
RUN_DIR="${REPO_ROOT}/.run"
mkdir -p "${RUN_DIR}"

for name in admin minteradmin; do
  if [[ ! -d "${IDENTITIES_DIR}/${name}/msp" ]]; then
    echo "error: '${name}' is not enrolled at ${IDENTITIES_DIR}/${name}/msp." >&2
    echo "       bootstrap it first -- see root README.md 'Identities' section." >&2
    exit 1
  fi
done

if [[ ! -d "${REPO_ROOT}/gateway/node_modules" ]]; then
  echo "==> installing gateway dependencies (first run)"
  (cd "${REPO_ROOT}/gateway" && npm install)
fi

# Same inline CA enrollment run-user.sh and enroll-charger.sh each already
# use -- kept duplicated rather than factored out, matching how those two
# scripts already do it independently.
enroll_identity() {
  local name="$1"
  if [[ -d "${IDENTITIES_DIR}/${name}/msp" ]]; then
    return
  fi
  echo "==> '${name}' not enrolled yet -- registering + enrolling against the CA"

  export PATH="${REPO_ROOT}/fabric-samples/bin:${PATH}"
  local tn="${REPO_ROOT}/fabric-samples/test-network"
  local ca_cert="${tn}/organizations/fabric-ca/org1/ca-cert.pem"
  local admin_msp="${IDENTITIES_DIR}/admin/msp"
  local secret
  secret="$(openssl rand -hex 16)"

  fabric-ca-client register --caname ca-org1 --id.name "${name}" --id.secret "${secret}" \
    --id.type client -u https://localhost:7054 --tls.certfiles "${ca_cert}" \
    --mspdir "${admin_msp}"
  fabric-ca-client enroll -u "https://${name}:${secret}@localhost:7054" --caname ca-org1 \
    -M "${IDENTITIES_DIR}/${name}/msp" --tls.certfiles "${ca_cert}"

  local nodeous_cfg="${tn}/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/config.yaml"
  cp "${nodeous_cfg}" "${IDENTITIES_DIR}/${name}/msp/config.yaml"
  echo "==> enrolled '${name}'"
}

echo "==> seeding demo topology (${STOP_COUNT} stops)"
cd "${REPO_ROOT}/gateway"
SEED_OUTPUT="$(npx tsx src/cli/demoSeed.ts seed "${STOP_COUNT}")"
cd "${REPO_ROOT}"

echo "==> stopping any charger-sims from a previous seed run"
if [[ -f "${RUN_DIR}/demo-sims.pid" ]]; then
  while read -r pid; do
    kill "${pid}" 2>/dev/null || true
  done <"${RUN_DIR}/demo-sims.pid"
fi
: >"${RUN_DIR}/demo-sims.pid"

MANIFEST="${RUN_DIR}/demo-chargers.json"
MANIFEST_ENTRIES=()
PORT="${BASE_ADMIN_PORT}"

while IFS='|' read -r CHARGER_ID PROVIDER_ID LOCATION_LABEL; do
  [[ -z "${CHARGER_ID}" ]] && continue
  echo "==> ${LOCATION_LABEL}: provider ${PROVIDER_ID}, charger ${CHARGER_ID} on :${PORT}"

  "${SCRIPT_DIR}/enroll-charger.sh" "${CHARGER_ID}"

  SIM_LOG="${RUN_DIR}/${CHARGER_ID}.sim.log"
  (cd "${REPO_ROOT}/charger-sim" && CHARGER_ID="${CHARGER_ID}" ADMIN_PORT="${PORT}" npm run dev) >"${SIM_LOG}" 2>&1 &
  echo "$!" >>"${RUN_DIR}/demo-sims.pid"

  MANIFEST_ENTRIES+=("\"${CHARGER_ID}\": ${PORT}")
  PORT=$((PORT + 1))
done <<<"${SEED_OUTPUT}"

{
  echo "{"
  ( IFS=,; echo "  ${MANIFEST_ENTRIES[*]}" )
  echo "}"
} >"${MANIFEST}"
echo "==> wrote charger port manifest: ${MANIFEST}"

echo "==> enrolling and funding demo driver identities"
enroll_identity "demo-driver"
enroll_identity "demo-driver-2"
"${SCRIPT_DIR}/faucet.sh" demo-driver "${DRIVER_BALANCE}"
"${SCRIPT_DIR}/faucet.sh" demo-driver-2 "${DRIVER_BALANCE}"

echo ""
echo "==> demo topology ready. In another terminal:"
echo "      ENABLE_DEV_DEMO=1 ./scripts/run-user.sh demo-driver 3099 5199"
echo "==> to tear down: ./scripts/demo-reset.sh"
