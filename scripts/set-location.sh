#!/usr/bin/env bash
# Dev tooling for CAR_LOCATION_ADDENDUM.md: sets a user's car location by
# writing location.json directly onto that user's identity volume. No
# gateway needs to be running -- this never talks to the peer or chaincode
# (location is off-ledger, see the addendum section 2.1).
#
# Usage:
#   ./scripts/set-location.sh <user> <lat> <lng>
#   GATEWAY_USER=<user> ./scripts/set-location.sh <lat> <lng>
#
# Example:
#   ./scripts/set-location.sh alice 41.0082 28.9784
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IDENTITIES_DIR="${REPO_ROOT}/gateway/identities"

usage() {
  echo "usage: set-location.sh <user> <lat> <lng>" >&2
  echo "       GATEWAY_USER=<user> set-location.sh <lat> <lng>" >&2
  exit 1
}

if [[ $# -eq 3 ]]; then
  USERNAME="$1"; LAT="$2"; LNG="$3"
elif [[ $# -eq 2 ]]; then
  USERNAME="${GATEWAY_USER:-}"
  [[ -n "${USERNAME}" ]] || usage
  LAT="$1"; LNG="$2"
else
  usage
fi

node -e '
const [lat, lng] = process.argv.slice(1, 3).map(Number);
if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
  console.error("error: lat must be a number in [-90, 90]");
  process.exit(1);
}
if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
  console.error("error: lng must be a number in [-180, 180]");
  process.exit(1);
}
' "${LAT}" "${LNG}"

USER_DIR="${IDENTITIES_DIR}/${USERNAME}"
mkdir -p "${USER_DIR}"
node -e '
const fs = require("fs");
const [file, lat, lng] = process.argv.slice(1);
fs.writeFileSync(file, JSON.stringify({ lat: Number(lat), lng: Number(lng) }));
' "${USER_DIR}/location.json" "${LAT}" "${LNG}"

echo "==> set '${USERNAME}' location to ${LAT}, ${LNG} (${USER_DIR}/location.json)"
echo "    reload that user's frontend to see the car marker move (no rebuild needed)."
