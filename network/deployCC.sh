#!/usr/bin/env bash
# Packages, installs, approves and commits the marketplace Java chaincode
# onto the running test-network channel.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEST_NETWORK_DIR="${REPO_ROOT}/fabric-samples/test-network"
CHAINCODE_DIR="${REPO_ROOT}/chaincode/marketplace"

export PATH="${REPO_ROOT}/fabric-samples/bin:${PATH}"
CHANNEL_NAME="${CHANNEL_NAME:-mychannel}"
CC_NAME="${CC_NAME:-marketplace}"
CC_VERSION="${CC_VERSION:-3.1}"
# Fabric's chaincode lifecycle requires a strictly increasing sequence number
# for every definition change on this channel, even across a language swap.
# Bump this if you redeploy again. Check the current committed sequence with:
#   peer lifecycle chaincode querycommitted --channelID <channel> --name marketplace
CC_SEQUENCE="${CC_SEQUENCE:-5}"

cd "${TEST_NETWORK_DIR}"
./network.sh deployCC -c "${CHANNEL_NAME}" -ccn "${CC_NAME}" -ccp "${CHAINCODE_DIR}" -ccl java -ccv "${CC_VERSION}" -ccs "${CC_SEQUENCE}"

echo ""
echo "Chaincode '${CC_NAME}' deployed on channel '${CHANNEL_NAME}'."
