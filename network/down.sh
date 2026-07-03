#!/usr/bin/env bash
# Tears down the Fabric test-network and removes generated crypto material.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEST_NETWORK_DIR="${REPO_ROOT}/fabric-samples/test-network"

export PATH="${REPO_ROOT}/fabric-samples/bin:${PATH}"

cd "${TEST_NETWORK_DIR}"
./network.sh down
