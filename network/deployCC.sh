#!/usr/bin/env bash
# Packages, installs, approves and commits the marketplace Go chaincode
# onto the running test-network channel.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEST_NETWORK_DIR="${REPO_ROOT}/fabric-samples/test-network"
CHAINCODE_DIR="${REPO_ROOT}/chaincode/marketplace"

export PATH="${REPO_ROOT}/fabric-samples/bin:${PATH}"
CHANNEL_NAME="${CHANNEL_NAME:-mychannel}"
CC_NAME="${CC_NAME:-marketplace}"
CC_VERSION="${CC_VERSION:-1.0}"

cd "${CHAINCODE_DIR}"
GOFLAGS="" go mod vendor

cd "${TEST_NETWORK_DIR}"
./network.sh deployCC -c "${CHANNEL_NAME}" -ccn "${CC_NAME}" -ccp "${CHAINCODE_DIR}" -ccl go -ccv "${CC_VERSION}"

echo ""
echo "Chaincode '${CC_NAME}' deployed on channel '${CHANNEL_NAME}'."
