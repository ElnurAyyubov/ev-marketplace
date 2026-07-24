#!/usr/bin/env bash
# Enrolls a Fabric CA identity for a charger, matching a chargerId already
# registered on-ledger via the UI/POST /chargers. Registering a charger only
# creates the ledger record (providerId, slotIndex, ratedPowerKw) -- it does
# not create the X.509 identity charger-sim needs to sign StartSession /
# RecordMeterReading as that charger. This script does just that enrollment
# step (same mechanism run-user.sh uses for regular users), with no gateway
# or frontend to launch afterwards since charger-sim talks to Fabric directly.
#
# Usage:
#   ./scripts/enroll-charger.sh <chargerId>
#
# Then:
#   cd charger-sim && CHARGER_ID=<chargerId> ADMIN_PORT=4001 npm run dev
#
# Prerequisites:
#   - Fabric network + CA up.
#   - The 'admin' identity already bootstrapped under gateway/identities/admin/
#     (root README "Identities" section) -- it's the registrar used here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CHARGER_ID="${1:?usage: enroll-charger.sh <chargerId>}"

IDENTITIES_DIR="${REPO_ROOT}/gateway/identities"

if [[ -d "${IDENTITIES_DIR}/${CHARGER_ID}/msp" ]]; then
  echo "==> '${CHARGER_ID}' is already enrolled at ${IDENTITIES_DIR}/${CHARGER_ID}/msp -- nothing to do"
  exit 0
fi

export PATH="${REPO_ROOT}/fabric-samples/bin:${PATH}"
TN="${REPO_ROOT}/fabric-samples/test-network"
CA_CERT="${TN}/organizations/fabric-ca/org1/ca-cert.pem"
ADMIN_MSP="${IDENTITIES_DIR}/admin/msp"

if [[ ! -d "${ADMIN_MSP}" ]]; then
  echo "error: ${ADMIN_MSP} not found." >&2
  echo "       bootstrap the 'admin' identity first -- see root README.md 'Identities' section." >&2
  exit 1
fi

echo "==> '${CHARGER_ID}' not enrolled yet -- registering + enrolling against the CA"

SECRET="$(openssl rand -hex 16)"

fabric-ca-client register --caname ca-org1 --id.name "${CHARGER_ID}" --id.secret "${SECRET}" \
  --id.type client -u https://localhost:7054 --tls.certfiles "${CA_CERT}" \
  --mspdir "${ADMIN_MSP}"

fabric-ca-client enroll -u "https://${CHARGER_ID}:${SECRET}@localhost:7054" --caname ca-org1 \
  -M "${IDENTITIES_DIR}/${CHARGER_ID}/msp" --tls.certfiles "${CA_CERT}"

# Node SDK identity loading needs NodeOUs config alongside the MSP material
# (root README "Identities" section) -- easy to miss, and skipping it fails
# loadIdentity/loadSigner in charger-sim/src/fabric.ts with a confusing
# ENOENT-style error instead of an obvious one.
NODEOUS_CFG="${TN}/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/config.yaml"
cp "${NODEOUS_CFG}" "${IDENTITIES_DIR}/${CHARGER_ID}/msp/config.yaml"

echo "==> enrolled '${CHARGER_ID}'"
echo "==> now run: cd charger-sim && CHARGER_ID=${CHARGER_ID} ADMIN_PORT=<port> npm run dev"
