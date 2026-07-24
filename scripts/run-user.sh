#!/usr/bin/env bash
# Launches one user's dedicated gateway + frontend pair.
#
# Usage:
#   ./scripts/run-user.sh <username> <gateway_port> <frontend_port>
#
# Example (two concurrent users):
#   ./scripts/run-user.sh alice 3001 5174   # terminal 1
#   ./scripts/run-user.sh bob   3002 5175   # terminal 2
#
# Prerequisites:
#   - Fabric network up, marketplace chaincode deployed (see root README).
#   - The 'admin' identity already bootstrapped under gateway/identities/admin/
#     (root README "Identities" section) -- it's the registrar used to
#     enroll every other username on demand.
#
# Requires the single-tenant gateway refactor: gateway/src/fabric.ts reads a
# required GATEWAY_USER env var instead of a KNOWN_IDENTITIES allowlist, and
# frontend reads VITE_USER_ID instead of a UI-selectable identity.
set -euo pipefail
set -m # each backgrounded job gets its own process group, see cleanup()

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

USERNAME="${1:?usage: run-user.sh <username> <gateway_port> <frontend_port>}"
GATEWAY_PORT="${2:?usage: run-user.sh <username> <gateway_port> <frontend_port>}"
FRONTEND_PORT="${3:?usage: run-user.sh <username> <gateway_port> <frontend_port>}"

IDENTITIES_DIR="${REPO_ROOT}/gateway/identities"

enroll_identity() {
  local name="$1"
  echo "==> '${name}' not enrolled yet -- registering + enrolling against the CA"

  export PATH="${REPO_ROOT}/fabric-samples/bin:${PATH}"
  local tn="${REPO_ROOT}/fabric-samples/test-network"
  local ca_cert="${tn}/organizations/fabric-ca/org1/ca-cert.pem"
  local admin_msp="${IDENTITIES_DIR}/admin/msp"

  if [[ ! -d "${admin_msp}" ]]; then
    echo "error: ${admin_msp} not found." >&2
    echo "       bootstrap the 'admin' identity first -- see root README.md 'Identities' section." >&2
    exit 1
  fi

  local secret
  secret="$(openssl rand -hex 16)"

  fabric-ca-client register --caname ca-org1 --id.name "${name}" --id.secret "${secret}" \
    --id.type client -u https://localhost:7054 --tls.certfiles "${ca_cert}" \
    --mspdir "${admin_msp}"

  fabric-ca-client enroll -u "https://${name}:${secret}@localhost:7054" --caname ca-org1 \
    -M "${IDENTITIES_DIR}/${name}/msp" --tls.certfiles "${ca_cert}"

  # Node SDK identity loading needs NodeOUs config alongside the MSP
  # material (root README "Identities" section) -- easy to miss, and
  # skipping it fails loadIdentity/loadSigner in gateway/src/fabric.ts with
  # a confusing error rather than an obvious one.
  local nodeous_cfg="${tn}/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/config.yaml"
  cp "${nodeous_cfg}" "${IDENTITIES_DIR}/${name}/msp/config.yaml"

  echo "==> enrolled '${name}'"
}

if [[ ! -d "${IDENTITIES_DIR}/${USERNAME}/msp" ]]; then
  enroll_identity "${USERNAME}"
fi

for dir in gateway frontend; do
  if [[ ! -d "${REPO_ROOT}/${dir}/node_modules" ]]; then
    echo "==> installing ${dir} dependencies (first run)"
    (cd "${REPO_ROOT}/${dir}" && npm install)
  fi
done

mkdir -p "${REPO_ROOT}/.run"
GATEWAY_LOG="${REPO_ROOT}/.run/${USERNAME}.gateway.log"

echo "==> starting gateway for '${USERNAME}' on :${GATEWAY_PORT} (log: ${GATEWAY_LOG})"
cd "${REPO_ROOT}/gateway"
GATEWAY_USER="${USERNAME}" PORT="${GATEWAY_PORT}" npm run dev >"${GATEWAY_LOG}" 2>&1 &
GATEWAY_PID=$!
cd "${REPO_ROOT}"

cleanup() {
  echo ""
  echo "==> stopping gateway for '${USERNAME}' (pid ${GATEWAY_PID})"
  # Negative PID targets the whole process group (npm -> tsx -> node), not
  # just the top npm process, so nothing is left orphaned when running
  # several users' gateways side by side.
  kill -TERM -- "-${GATEWAY_PID}" 2>/dev/null || true
  wait "${GATEWAY_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 1
if ! kill -0 "${GATEWAY_PID}" 2>/dev/null; then
  echo "error: gateway failed to start -- see ${GATEWAY_LOG}" >&2
  exit 1
fi

echo "==> gateway:  http://localhost:${GATEWAY_PORT}"
echo "==> frontend: http://localhost:${FRONTEND_PORT} (starting...)"
echo ""

cd "${REPO_ROOT}/frontend"
VITE_USER_ID="${USERNAME}" VITE_GATEWAY_URL="http://localhost:${GATEWAY_PORT}" \
  npm run dev -- --port "${FRONTEND_PORT}" --strictPort
