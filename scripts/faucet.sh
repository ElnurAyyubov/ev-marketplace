#!/usr/bin/env bash
# Dev-only faucet: mints tokens to a userId, signed by the 'admin' identity.
# No gateway needs to be running -- this talks to the peer directly.
#
# Usage: ./scripts/faucet.sh <userId> <amount>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

USER_ID="${1:?usage: faucet.sh <userId> <amount>}"
AMOUNT="${2:?usage: faucet.sh <userId> <amount>}"

cd "${REPO_ROOT}/gateway"
npx tsx src/cli/faucet.ts "${USER_ID}" "${AMOUNT}"
