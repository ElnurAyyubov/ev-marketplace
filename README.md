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

## Running the demo (from a clean checkout)

```bash
# 1. Bring up the Fabric test-network (2 orgs, CouchDB, channel "mychannel")
./network/up.sh

# 2. Deploy the marketplace chaincode (Java; builds via the Gradle wrapper)
./network/deployCC.sh

# 3. Bootstrap identities (one-time). See "Identities" below for what each
#    one is and why they're separate; this is just the commands.
export PATH=$PATH:$(pwd)/fabric-samples/bin

#    admin: the CA's own bootstrap identity, and the registrar every other
#    identity below gets enrolled through.
fabric-ca-client enroll -u https://admin:adminpw@localhost:7054 --caname ca-org1 \
  -M "$(pwd)/gateway/identities/admin/msp" \
  --tls.certfiles "$(pwd)/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem"

#    minteradmin: the only identity chaincode allows to mint tokens (faucet).
./scripts/enroll-identity.sh minteradmin

#    carregistrar: scoped CA registrar used by self-provisioning containers
#    (skip this if you're only using run-user.sh, not Docker).
./scripts/enroll-car-registrar.sh

# 4. Launch a dedicated gateway + frontend pair per user. Each call
#    auto-enrolls the username the first time it's used, then starts both,
#    wired together — no identity picker, no shared multi-tenant gateway.
./scripts/run-user.sh alice     3001 5174   # terminal 1
./scripts/run-user.sh provider1 3002 5175   # terminal 2, another user

# 5. Mint alice some balance to actually reserve/pay for anything:
./scripts/faucet.sh alice 500

# 6. Start one (or more) simulated smart chargers — see charger-sim/README.md.
#    A charger first needs its own enrolled identity (separate from the
#    on-ledger RegisterCharger call made from a provider owner's frontend):
./scripts/enroll-charger.sh charger1
cd charger-sim && npm install
CHARGER_ID=charger1 ADMIN_PORT=4001 npm run dev
```

Steps 4-6 are the local-dev path (`run-user.sh`, one process per user on your
own machine). For installing on a physical device that provisions its own
identity on first boot instead, see "Running as a self-provisioning
container" below — it only needs steps 1-3 first (`carregistrar` in
particular; skip enrolling any per-user identity by hand).

Tear down with `./network/down.sh`. Containers can also stop independently
across a host restart/sleep — the Fabric CA containers in particular have no
restart policy and can be left behind while the peers/orderer stay up
(`docker ps -a` will show them `Exited`). Bring the missing ones back
individually rather than tearing the whole network down:
```bash
docker start couchdb0 couchdb1 orderer.example.com \
  peer0.org1.example.com peer0.org2.example.com \
  ca_org1 ca_org2 ca_orderer
```

## Identities

The browser never talks to Fabric directly — it can't hold X.509
credentials or speak the peer gRPC protocol. Each user gets their own
dedicated gateway process holding exactly one identity's private key, and
their own frontend instance pointed at it (`scripts/run-user.sh`, see
above). There's no shared multi-tenant gateway and no "acting as" dropdown
— a frontend tab only ever acts as the one identity its gateway was started
with. Usernames are enrolled against the Org1 Fabric CA automatically the
first time `run-user.sh` sees a name that doesn't exist yet under
`gateway/identities/` (registering it using the already-enrolled `admin`
identity as the CA registrar — see `scripts/run-user.sh` for the exact
`fabric-ca-client` calls).

That means `admin` itself has to be bootstrapped once, directly against the
CA's own bootstrap credentials, before running `run-user.sh` for anyone
else:

```bash
export PATH=$PATH:$(pwd)/fabric-samples/bin
fabric-ca-client enroll -u https://admin:adminpw@localhost:7054 --caname ca-org1 \
  -M "$(pwd)/gateway/identities/admin/msp" \
  --tls.certfiles "$(pwd)/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem"
```

Minting and CA registration are deliberately separate privileges, held by
two different identities, neither of which is `admin` itself:

- **`minteradmin`** is the only identity allowed to mint tokens
  (chaincode-enforced in `SmartContract.java`'s `Mint`/
  `ResetMarketplaceData`, checking `Constants.ADMIN_IDENTITY`). It has no
  special CA privileges — enroll it like any ordinary identity, with no
  gateway/frontend needed afterwards:
  ```bash
  ./scripts/enroll-identity.sh minteradmin
  ```
  There's no faucet button in any frontend — mint from the CLI instead,
  which connects directly as `minteradmin` without needing any gateway
  running:
  ```bash
  ./scripts/faucet.sh alice 500
  ```
- **`carregistrar`** (`./scripts/enroll-car-registrar.sh`) can *only*
  register new client identities against the CA (enrolled with the CA
  attribute `hf.Registrar.Roles=client`) — it has no chaincode-level power
  at all. This is the identity meant for self-provisioning devices (see
  "Running as a self-provisioning container" below): delivered to a
  device out-of-band, consumed once to register that device's chosen
  username, then deleted from it.

`admin` still exists as the CA's own root registrar, used only to create
`minteradmin`/`carregistrar`/regular usernames — see
`CONTAINER_PROVISIONING_ADDENDUM.md` "The identity split" for the full
reasoning.

**Chargers** are a separate case. Registering one from a provider owner's
frontend (`Provider Owner View` → register charger) only creates the
on-ledger `Charger` record (providerId/slotIndex/ratedPowerKw) — it does
**not** enroll a CA identity. `charger-sim` needs an actual certificate
under that same name to sign `StartSession`/`RecordMeterReading` (Addendum A
section 7), so enroll it once, using whatever chargerId you registered
on-ledger:
```bash
./scripts/enroll-charger.sh <chargerId>
```

The chaincode derives every caller's identity from their certificate's
CommonName, so on-chain a user or charger simply shows up as whatever name
you passed to `run-user.sh` / `enroll-charger.sh`.

## Running as a self-provisioning container

`scripts/run-user.sh` is for local dev, where you already know the
username up front. For installing on a physical device ("a car") that
should self-register the first time someone uses it, one generic image
(`Dockerfile`, repo root) serves the gateway and the built frontend on a
single port, and provisions itself on first boot instead of taking a
username as a launch argument. Full design and reasoning:
`CONTAINER_PROVISIONING_ADDENDUM.md`. Quick version:

1. One-time, on your machine: enroll the device registrar credential —
   `./scripts/enroll-car-registrar.sh` (see "Identities" above).
2. Per device: create a persistent volume and seed it with a *copy* of
   that credential (never baked into the image — see
   `docker-compose.example.yml`'s header comment for the exact commands).
3. `docker compose -f docker-compose.example.yml up --build` (that example
   file targets this repo's own local test-network; point
   `PEER_ENDPOINT`/`CA_ENDPOINT`/`*_TLS_CERT_PATH` at a real network for an
   actual deployment).
4. Open the device's frontend. First boot shows a "register this device"
   screen; the username entered there is enrolled, the one-time credential
   is deleted from the device's volume, and the container restarts into
   the normal single-tenant gateway — from then on indistinguishable from
   a `run-user.sh` instance, except the identity was chosen on-device
   rather than passed on a command line.

## Demo loop

Launch a gateway+frontend pair per participant, each in its own
terminal/browser tab:
```bash
./scripts/run-user.sh alice     3001 5174
./scripts/run-user.sh provider1 3002 5175
./scripts/run-user.sh bob       3003 5176
```

1. **Register User** — in alice's tab (`:5174`) and provider1's tab
   (`:5175`)/bob's tab (`:5176`), use "Register User".
2. **Create Provider** — in provider1's tab, register a Commercial provider
   (multi-slot, no approval needed); in bob's tab, register a Residential
   provider with "require my approval" checked.
3. Mint alice some balance: `./scripts/faucet.sh alice 500`.
4. **Provider Owner View** — in the owning tab, register a charger
   (`charger1`) against one of the provider's slots, giving it a rated
   power in kW. This binds that charger identity to the slot; only that
   identity may start sessions or record readings there. Then enroll its CA
   identity and start the simulator (see "Identities" above):
   ```bash
   ./scripts/enroll-charger.sh charger1
   cd charger-sim && CHARGER_ID=charger1 ADMIN_PORT=4001 npm run dev
   ```
5. **Marketplace** (alice's tab) — search/filter, click a provider on the
   map or list.
6. **Reserve** — in alice's tab, pick a free slot and reserve. Commercial
   reservations confirm immediately (hold locked); residential ones sit as
   `REQUESTED` until the owner approves.
7. **Provider Owner View** — in bob's tab, approve the pending reservation
   (locks the hold). The reservation is now `CONFIRMED`, waiting for the
   bound charger to start the session.
8. With `charger-sim` running for `charger1`, simulate plug-in:
   `curl -X POST http://localhost:4001/sim/plugin -d '{"reservationId":"..."}'`.
   The simulator starts the session and begins recording signed meter
   readings every `READING_INTERVAL_MS` (15s default).
9. **My Reservations** (alice's tab) shows the live charging ticker: kWh and
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
- All identities (including chargers) are provisioned from Org1's CA for
  simplicity — MSP org membership isn't meaningful to the business logic;
  the charger/driver/owner distinction is enforced purely by certificate
  CommonName checks in chaincode.
- Per-user key custody is a process boundary, not a physical one: each
  user's private key lives on whatever machine runs `scripts/run-user.sh`
  for them, not on a separate device/HSM they alone control.
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