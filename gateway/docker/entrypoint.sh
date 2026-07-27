#!/usr/bin/env sh
# Picks which server to run based on whether this device already holds a
# provisioned identity. See gateway/src/provisioning.ts (writes the marker)
# and CONTAINER_PROVISIONING_ADDENDUM.md "The provisioning state machine".
set -eu

MARKER="${IDENTITIES_DIR:-/app/gateway/identities}/.provisioned-user"

if [ -f "$MARKER" ]; then
  export GATEWAY_USER="$(cat "$MARKER")"
  echo "==> provisioned as '${GATEWAY_USER}' -- starting the marketplace gateway"
  exec node dist/index.js
else
  echo "==> no identity provisioned yet -- starting the setup server"
  exec node dist/setupServer.js
fi
