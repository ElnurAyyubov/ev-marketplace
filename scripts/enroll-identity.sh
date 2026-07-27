#!/usr/bin/env bash
# Enrolls a plain Fabric CA client identity with no gateway/frontend
# launched afterwards -- for identities that are never "acted as" through
# a browser tab, e.g. minteradmin (see root README "Identities"). For a
# regular user you want a gateway+frontend for, use scripts/run-user.sh
# instead; for a charger identity, use scripts/enroll-charger.sh (same
# logic, charger-specific messaging).
#
# Usage:
#   ./scripts/enroll-identity.sh <name>
#
# Prerequisites:
#   - Fabric network + CA up.
#   - The 'admin' identity already bootstrapped under gateway/identities/admin/
#     (root README "Identities" section) -- it's the registrar used here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

NAME="${1:?usage: enroll-identity.sh <name>}"
IDENTITIES_DIR="${REPO_ROOT}/gateway/identities"

if [[ -d "${IDENTITIES_DIR}/${NAME}/msp" ]]; then
  echo "==> '${NAME}' is already enrolled at ${IDENTITIES_DIR}/${NAME}/msp -- nothing to do"
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

echo "==> '${NAME}' not enrolled yet -- registering + enrolling against the CA"

SECRET="$(openssl rand -hex 16)"

fabric-ca-client register --caname ca-org1 --id.name "${NAME}" --id.secret "${SECRET}" \
  --id.type client -u https://localhost:7054 --tls.certfiles "${CA_CERT}" \
  --mspdir "${ADMIN_MSP}"

fabric-ca-client enroll -u "https://${NAME}:${SECRET}@localhost:7054" --caname ca-org1 \
  -M "${IDENTITIES_DIR}/${NAME}/msp" --tls.certfiles "${CA_CERT}"

echo "==> enrolled '${NAME}'"
