#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

USERNAME="minteradmin"
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