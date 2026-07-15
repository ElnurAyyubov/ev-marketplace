# EV Charging Marketplace — MVP

A decentralized marketplace for community-owned EV charging infrastructure,
built on Hyperledger Fabric. Drivers can discover, reserve, use, and pay for
charging at both commercial stations and residential charge points. See
`MVP_BUILD_SPEC.md` for the full base design and milestone breakdown, and
`SMART_CHARGER_ADDENDUM.md` for the metering/settlement architecture
actually implemented (it amends and supersedes the base spec's
provider-reported-energy + challenge-window escrow design).

## Trust assumption (stated verbatim, per the addendum)

> Each charging point is equipped with a tamper-resistant smart metering
> device that (a) holds its own X.509 ledger identity issued by the network
> CA, (b) measures delivered energy accurately, and (c) signs and submits
> cumulative meter readings directly to the ledger at a fixed interval
> during an active session. Readings from this device are treated as ground
> truth for settlement. Device certification, sealed firmware, and physical
> anti-tamper measures are out of scope and assumed.

Payment settles through a **pre-authorization hold**: at reservation
confirmation, `requestedEnergy × pricePerkWh` is locked from the driver's
balance; when the session stops, settlement is computed deterministically
from the charger's last on-ledger cumulative meter reading — never from a
number typed into a form. The base spec's provider-self-reported-energy +
`SETTLED_PENDING` challenge-window + dispute-arbitration design is **not**
implemented in this codebase; it remains documented (see
`SMART_CHARGER_ADDENDUM.md` section 1, item 4) as the fallback architecture
for deployments without certified metering hardware. All that survives of
it here is a vestigial `FlagChargerMalfunction` acknowledgement, which does
not reopen or reverse settlement.

## Prerequisites

- Docker + Docker Compose (daemon running)
- JDK 11+ (chaincode is built with the Gradle wrapper checked into `chaincode/marketplace/` — no separate Gradle install needed)
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

# 2. Deploy the marketplace chaincode (Java; builds via the Gradle wrapper)
./network/deployCC.sh

# 3. Pre-enroll the fixed demo identities the gateway acts as
#    (admin / alice / bob / provider1) plus at least one charger identity
#    (charger1) — see "Identities" below.

# 4. Start the gateway REST service
cd gateway
npm install
npm run build
npm start          # listens on http://localhost:3000

# 5. Start the frontend
cd frontend
npm install
npm run dev         # http://localhost:5173

# 6. Start one (or more) simulated smart chargers — see charger-sim/README.md
cd charger-sim
npm install
CHARGER_ID=charger1 ADMIN_PORT=4001 npm run dev
```

Tear down with `./network/down.sh`.

## Identities (MVP simplification)

Per the build spec (section 5), the browser never talks to Fabric directly —
it can't hold X.509 credentials or speak the peer gRPC protocol. The gateway
service holds a small fixed set of pre-enrolled identities and the frontend
selects which one to act as via an "acting as" dropdown, sent as the
`X-Identity` header on every request. Real per-user CA enrollment is out of
scope for this MVP.

The demo ships with these identities enrolled from the test-network's Org1
CA: `admin` (faucet/mint authority), `alice`, `bob`, `provider1`, plus
charger identities `charger1`/`charger2`. Charger identities are enrolled
the same way as any other client identity, but are used only by the
`charger-sim` daemon (Addendum A section 7) — never selectable in the
frontend's "acting as" dropdown, since the entire point of the trusted-
metering architecture is that only the charger's own certificate can sign
`StartSession`/`RecordMeterReading`. To (re-)enroll all of them against a
fresh network:

```bash
export PATH=$PATH:$(pwd)/fabric-samples/bin
TN=$(pwd)/fabric-samples/test-network
CA_CERT=${TN}/organizations/fabric-ca/org1/ca-cert.pem
OUT=$(pwd)/gateway/identities

# "admin" is the CA's own bootstrap identity — enroll it directly.
fabric-ca-client enroll -u https://admin:adminpw@localhost:7054 --caname ca-org1 \
  -M "${OUT}/admin/msp" --tls.certfiles "$CA_CERT"

# Register + enroll the rest as ordinary client identities (drivers/owners
# and chargers alike — the chaincode distinguishes them by role via the
# Charger record's chargerId binding, not by MSP attributes).
for name in alice bob provider1 charger1 charger2; do
  fabric-ca-client register --caname ca-org1 --id.name "$name" --id.secret "${name}pw" \
    --id.type client -u https://localhost:7054 --tls.certfiles "$CA_CERT" \
    --mspdir "${OUT}/admin/msp"
  fabric-ca-client enroll -u https://${name}:${name}pw@localhost:7054 --caname ca-org1 \
    -M "${OUT}/${name}/msp" --tls.certfiles "$CA_CERT"
done

# peer CLI / Node MSP loading needs NodeOUs config alongside each identity.
CFG=${TN}/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/config.yaml
for name in admin alice bob provider1 charger1 charger2; do
  cp "$CFG" "${OUT}/${name}/msp/config.yaml"
done
```

The chaincode derives each caller's identity from their certificate's
CommonName, so these show up on-chain simply as `admin`, `alice`, `bob`,
`provider1`, `charger1`, `charger2`.

## Demo loop

1. **Register User** — register `alice` (driver) and `provider1` (owns a
   commercial station) and/or `bob` (owns a residential charger).
2. **Create Provider** — as `provider1`, register a Commercial provider
   (multi-slot, no approval needed); as `bob`, register a Residential
   provider with "require my approval" checked.
3. Use the faucet in the identity bar to mint `alice` some balance.
4. **Provider Owner View** — as the provider owner, register a charger
   (`charger1`) against one of the provider's slots, giving it a rated
   power in kW. This binds that charger identity to the slot; only that
   identity may start sessions or record readings there.
5. **Marketplace** — search/filter, click a provider on the map or list.
6. **Reserve** — as `alice`, pick a free slot and reserve. Commercial
   reservations confirm immediately (hold locked); residential ones sit as
   `REQUESTED` until the owner approves.
7. **Provider Owner View** — as `bob`, approve the pending reservation
   (locks the hold). The reservation is now `CONFIRMED`, waiting for the
   bound charger to start the session.
8. With `charger-sim` running for `charger1`, simulate plug-in:
   `curl -X POST http://localhost:4001/sim/plugin -d '{"reservationId":"..."}'`.
   The simulator starts the session and begins recording signed meter
   readings every `READING_INTERVAL_MS` (15s default).
9. **My Reservations** (as `alice`) shows the live charging ticker: kWh and
   running cost counting up, anchored to real on-ledger readings. Click
   **Stop Charging** (or let the simulator's hold-cap auto-stop trigger) —
   settlement is computed entirely from the last on-ledger cumulative
   reading, paying the provider and refunding the driver the remainder.
   No party ever types in a delivered-energy number.

## Known MVP limitations (documented, not bugs)

- Token balances are simple mutable counters
  (`chaincode/marketplace/src/main/java/marketplace/TokenLedger.java`), not
  event-sourced. Fine for this demo; would need hardening for real
  concurrent load.
- `FlagChargerMalfunction` only records an off-chain-followup flag; per the
  stated trust assumption there is nothing on-ledger left to adjudicate, so
  there is no resolution workflow and it never reopens settlement.
- All demo identities (including chargers) are provisioned from Org1's CA
  for simplicity — MSP org membership isn't meaningful to the business
  logic; the charger/driver/owner distinction is enforced purely by
  certificate CommonName checks in chaincode.
- Device certification, sealed firmware, and physical anti-tamper measures
  for the smart-charger hardware are assumed, not implemented (see the
  trust assumption above).

## Chaincode implementation

The chaincode (`chaincode/marketplace/`) is implemented in Java against
`fabric-contract-api-java`/`fabric-chaincode-shim`, built with the Gradle
wrapper (`./gradlew installDist`, invoked automatically by
`network/deployCC.sh`). It was ported from an earlier Go implementation;
the REST/gateway/frontend layers are unchanged since chaincode invocation
is language-agnostic (function name + JSON string args over the Fabric
Gateway SDK).

Smart-charger metering surface added by `SMART_CHARGER_ADDENDUM.md`:
`RegisterCharger`/`GetCharger`/`QueryChargersByProvider`, charger-only
`StartSession`, `RecordMeterReading` (identity + monotonicity + rate-cap +
hold-cap checks), `StopSession` (replaces `CompleteSession`),
`GetSessionReadings`, and `FlagChargerMalfunction` (replaces
`DisputeSession`). See `chaincode/marketplace/src/main/java/marketplace/SmartContract.java`.

If you redeploy the chaincode again after this, bump `CC_SEQUENCE` in
`network/deployCC.sh` (Fabric requires a strictly increasing sequence
number per definition change on the channel) — check the current value
with:
```bash
peer lifecycle chaincode querycommitted --channelID mychannel --name marketplace
```

to start:
docker start couchdb0 couchdb1 ca_orderer ca_org1 ca_org2
docker start orderer.example.com
docker start peer0.org1.example.com peer0.org2.example.com

cd /home/nurx/Desktop/Research/dapp/gateway
npm start          # http://localhost:3000

cd /home/nurx/Desktop/Research/dapp/frontend
npm run dev        # http://localhost:5173
