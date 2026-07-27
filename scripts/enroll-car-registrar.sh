#!/usr/bin/env bash
# Enrolls 'carregistrar': a CA identity scoped to ONLY register new client
# identities (hf.Registrar.Roles=client) -- it cannot register other
# registrars/admins, revoke certs, or manage affiliations. This is the
# credential meant to be copied out-of-band onto each car's persistent
# volume (never baked into the shared container image), consumed exactly
# once by that car's first-boot self-registration flow, then deleted from
# the car. See CONTAINER_PROVISIONING_ADDENDUM.md "The identity split".
#
# Usage:
#   ./scripts/enroll-car-registrar.sh
#
# Prerequisites:
#   - Fabric CA up.
#   - The 'admin' identity already bootstrapped under gateway/identities/admin/
#     (root README "Identities" section) -- it's the registrar used here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

NAME="carregistrar"
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

echo "==> registering + enrolling '${NAME}' (scoped: hf.Registrar.Roles=client only)"

SECRET="$(openssl rand -hex 16)"

fabric-ca-client register --caname ca-org1 --id.name "${NAME}" --id.secret "${SECRET}" \
  --id.type client --id.attrs 'hf.Registrar.Roles=client:ecert' \
  -u https://localhost:7054 --tls.certfiles "${CA_CERT}" \
  --mspdir "${ADMIN_MSP}"

fabric-ca-client enroll -u "https://${NAME}:${SECRET}@localhost:7054" --caname ca-org1 \
  -M "${IDENTITIES_DIR}/${NAME}/msp" --tls.certfiles "${CA_CERT}"

echo "==> enrolled '${NAME}'"
echo "==> verify its scope before relying on it: try using it to register another registrar and confirm that's rejected"
echo "==> this MSP folder is what gets copied out-of-band onto each car's volume, not baked into any image"
