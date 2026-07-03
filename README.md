# EV Charging Marketplace — MVP

A decentralized marketplace for community-owned EV charging infrastructure,
built on Hyperledger Fabric. Drivers can discover, reserve, use, and pay for
charging at both commercial stations and residential charge points, with
payment settled through an on-chain escrow mechanism. See
`MVP_BUILD_SPEC.md` for the full design and milestone breakdown.

## Prerequisites

- Docker + Docker Compose (daemon running)
- Go 1.21+
- Node.js 18+ and npm
- `jq`
- [`fabric-samples`](https://github.com/hyperledger/fabric-samples) with Fabric 2.5.x binaries
  (installed via the official `install-fabric.sh` script). This repo assumes
  `fabric-samples/` lives at the repo root, alongside `network/`,
  `chaincode/`, `gateway/`, and `frontend/`. If you don't have it yet:

  ```bash
  curl -fsSL --max-time 30 https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh -o install-fabric.sh
  chmod +x install-fabric.sh
  ./install-fabric.sh docker binary samples
  ```

## Running the demo

```bash
# 1. Bring up the Fabric test-network (2 orgs, CouchDB, channel "mychannel")
./network/up.sh

# 2. Deploy the marketplace chaincode
./network/deployCC.sh

# 3. Pre-enroll the fixed demo identities the gateway acts as
#    (admin / alice / bob / provider1) — see "Identities" below.

# 4. Start the gateway REST service
cd gateway
npm install
npm run build
npm start          # listens on http://localhost:3000

# 5. Start the frontend
cd frontend
npm install
npm run dev         # http://localhost:5173
```

Tear down with `./network/down.sh`.

## Identities (MVP simplification)

Per the build spec (section 5), the browser never talks to Fabric directly —
it can't hold X.509 credentials or speak the peer gRPC protocol. The gateway
service holds a small fixed set of pre-enrolled identities and the frontend
selects which one to act as via an "acting as" dropdown, sent as the
`X-Identity` header on every request. Real per-user CA enrollment is out of
scope for this MVP.

The demo ships with four identities enrolled from the test-network's Org1 CA:
`admin` (faucet/mint authority), `alice`, `bob`, `provider1`. To (re-)enroll
them against a fresh network:

```bash
export PATH=$PATH:$(pwd)/fabric-samples/bin
TN=$(pwd)/fabric-samples/test-network
CA_CERT=${TN}/organizations/fabric-ca/org1/ca-cert.pem
OUT=$(pwd)/gateway/identities

# "admin" is the CA's own bootstrap identity — enroll it directly.
fabric-ca-client enroll -u https://admin:adminpw@localhost:7054 --caname ca-org1 \
  -M "${OUT}/admin/msp" --tls.certfiles "$CA_CERT"

# Register + enroll the rest as ordinary client identities.
for name in alice bob provider1; do
  fabric-ca-client register --caname ca-org1 --id.name "$name" --id.secret "${name}pw" \
    --id.type client -u https://localhost:7054 --tls.certfiles "$CA_CERT" \
    --mspdir "${OUT}/admin/msp"
  fabric-ca-client enroll -u https://${name}:${name}pw@localhost:7054 --caname ca-org1 \
    -M "${OUT}/${name}/msp" --tls.certfiles "$CA_CERT"
done

# peer CLI / Node MSP loading needs NodeOUs config alongside each identity.
CFG=${TN}/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/config.yaml
for name in admin alice bob provider1; do
  cp "$CFG" "${OUT}/${name}/msp/config.yaml"
done
```

The chaincode derives each caller's `userId` from their certificate's
CommonName, so these identities show up on-chain simply as `admin`, `alice`,
`bob`, `provider1`.

## Demo loop

1. **Register User** — register `alice` (driver) and `provider1` (owns a
   commercial station) and/or `bob` (owns a residential charger).
2. **Create Provider** — as `provider1`, register a Commercial provider
   (multi-slot, no approval needed); as `bob`, register a Residential
   provider with "require my approval" checked.
3. Use the faucet in the identity bar to mint `alice` some balance.
4. **Marketplace** — search/filter, click a provider on the map or list.
5. **Reserve** — as `alice`, pick a free slot and reserve. Commercial
   reservations confirm immediately (escrow locked); residential ones sit as
   `REQUESTED` until the owner approves.
6. **Provider Owner View** — as `bob`, approve the pending reservation
   (locks escrow); as either owner, start the session once `CONFIRMED`.
7. Report delivered energy to **Complete Session** — escrow settles: the
   provider is paid `deliveredEnergy × pricePerkWh` (capped at the escrow),
   the driver is refunded the remainder.
8. **My Reservations** (as `alice`) shows escrow held → settled, balances
   updating on-ledger throughout.

## Known MVP limitations (documented, not bugs)

- Token balances are simple mutable counters (`gateway`/chaincode
  `token.go`), not event-sourced. Fine for this demo; would need hardening
  for real concurrent load (see `chaincode/marketplace/token.go`).
- Disputes only flag a session (`DisputeSession`); there is no resolution
  workflow.
- All demo identities are provisioned from Org1's CA for simplicity — MSP
  org membership isn't meaningful to the business logic.
