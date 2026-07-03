#!/usr/bin/env bash
# Brings up the Fabric test-network (2 orgs, CAs) with CouchDB as the state
# database, and creates the application channel used by this project.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEST_NETWORK_DIR="${REPO_ROOT}/fabric-samples/test-network"

export PATH="${REPO_ROOT}/fabric-samples/bin:${PATH}"
CHANNEL_NAME="${CHANNEL_NAME:-mychannel}"

if ! docker info >/dev/null 2>&1; then
  echo "Docker does not appear to be running. Start Docker and re-run." >&2
  exit 1
fi

cd "${TEST_NETWORK_DIR}"

# Pre-warm CouchDB before starting the peers. On first boot each CouchDB
# container takes a moment to finish applying its COUCHDB_USER/PASSWORD
# admin config; if a peer's very first state-DB connection lands in that
# window it gets a 401 and crashes (fabric-samples issue, not specific to
# this project). Starting CouchDB first and waiting for authenticated
# requests to succeed avoids that race.
echo "Pre-starting CouchDB (avoids a peer/CouchDB startup race)..."
DOCKER_SOCK="$(docker context inspect --format '{{ .Endpoints.docker.Host }}' | sed 's#^unix://##')"
export DOCKER_SOCK
docker compose \
  -f compose/compose-test-net.yaml \
  -f compose/docker/docker-compose-test-net.yaml \
  -f compose/compose-couch.yaml \
  up -d couchdb0 couchdb1

for name in couchdb0 couchdb1; do
  port=5984
  if [ "${name}" = "couchdb1" ]; then port=7984; fi
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://admin:adminpw@localhost:${port}/_up" || true)
    if [ "${code}" = "200" ]; then
      echo "${name} ready"
      break
    fi
    sleep 1
    if [ "${i}" = "30" ]; then
      echo "${name} did not become ready in time" >&2
      exit 1
    fi
  done
done

./network.sh up createChannel -c "${CHANNEL_NAME}" -ca -s couchdb

echo ""
echo "Network is up. Channel '${CHANNEL_NAME}' created with CouchDB state database."
echo "Next: ./network/deployCC.sh"
