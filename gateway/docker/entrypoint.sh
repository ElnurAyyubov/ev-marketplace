#!/usr/bin/env sh
# Picks which server to run based on whether this device already holds a
# provisioned identity. See gateway/src/provisioning.ts (writes the marker)
# and CONTAINER_PROVISIONING_ADDENDUM.md "The provisioning state machine".
set -eu

MARKER="${IDENTITIES_DIR:-/app/gateway/identities}/.provisioned-user"

# whisper-server (voice search ASR, VOICE_INPUT_ADDENDUM.md) is baked into
# this image and runs as a sibling process in the SAME container as the
# gateway -- no host dependency. Bound to 127.0.0.1 (not 0.0.0.0): unlike a
# shared host-level whisper-server reached across containers, this one only
# ever needs to answer this container's own gateway process. WHISPER_URL's
# code default (http://localhost:8080) is already correct for this. Started
# in the background before either server mode below is exec'd, so it's
# already warm by the time a request can reach it either way; VOICE_ENABLED
# also skips starting it at all, saving the RAM/CPU on cars that don't want
# voice search.
if [ "${VOICE_ENABLED:-true}" != "false" ]; then
  echo "==> starting whisper-server (voice search ASR)"
  /app/whisper/whisper-server \
    -m /app/whisper/models/ggml-base.en.bin \
    -t "${WHISPER_THREADS:-4}" --port 8080 --host 127.0.0.1 &
fi

if [ -f "$MARKER" ]; then
  export GATEWAY_USER="$(cat "$MARKER")"
  echo "==> provisioned as '${GATEWAY_USER}' -- starting the marketplace gateway"
  exec node dist/index.js
else
  echo "==> no identity provisioned yet -- starting the setup server"
  exec node dist/setupServer.js
fi
