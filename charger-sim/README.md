# Charger simulator daemon

Plays the role of the physical smart-charger device described in
`SMART_CHARGER_ADDENDUM.md`. It signs and submits transactions with a
pre-enrolled **charger identity** (its own X.509 certificate, distinct from
the provider that owns it) directly against a Fabric peer -- it does **not**
go through the gateway's REST API for `StartSession`, `RecordMeterReading`,
or `StopSession`. The trust story of Addendum A is about which certificate
signs a transaction, not which process hosts the code, so this reuses the
same connection pattern as `gateway/src/fabric.ts` but scoped to a single
identity (`src/fabric.ts`).

## Prerequisites

- The Fabric network up and the `marketplace` chaincode deployed (see the
  repo root README).
- A charger identity (e.g. `charger1`) pre-enrolled under
  `gateway/identities/charger1/` -- see the root README's "Identities"
  section for the enrollment commands (charger identities are enrolled the
  same way as `alice`/`bob`, just with a `charger` name prefix).
- That charger already bound to a provider slot via `RegisterCharger` /
  `POST /chargers` (done by the provider owner, before starting the
  simulator).

## Running one simulated charger

```bash
cd charger-sim
npm install

CHARGER_ID=charger1 \
ADMIN_PORT=4001 \
npm run dev          # or: npm run build && CHARGER_ID=charger1 ADMIN_PORT=4001 npm start
```

On startup the simulator looks up its own charger record on-ledger
(`GetCharger`) to learn which `(providerId, slotIndex)` it's bound to and
its `ratedPowerKw` -- no need to pass those separately.

## Running more than one

Each charger needs its own identity, own `CHARGER_ID`, and its own
`ADMIN_PORT` (they'd otherwise collide on the same local port):

```bash
CHARGER_ID=charger1 ADMIN_PORT=4001 npm run dev   # terminal 1
CHARGER_ID=charger2 ADMIN_PORT=4002 npm run dev   # terminal 2
```

## Simulating plug-in / unplug

The simulator exposes a tiny local admin API (not part of the public
gateway) to trigger physical events by hand -- this demos better than
silent auto-detection:

```bash
# Plug in: starts the session for a CONFIRMED reservation on this charger's slot
curl -X POST http://localhost:4001/sim/plugin -H 'Content-Type: application/json' \
  -d '{"reservationId": "res-..."}'

# Check status
curl http://localhost:4001/sim/status

# Unplug: stops the session early (equivalent to a driver walking away
# without using the app's Stop Charging button)
curl -X POST http://localhost:4001/sim/unplug
```

Once plugged in, the simulator records a meter reading every
`READING_INTERVAL_MS` (default 15000ms), computed as
`ratedPowerKw × elapsed time`. If a reading would push the implied cost past
the reservation's locked hold, the chaincode rejects it and the simulator
stops the session automatically (the hold-cap auto-stop). It also polls the
session's on-ledger state every `STOP_POLL_INTERVAL_MS` (default 3000ms) so
it notices and goes idle if the driver stops the session from the frontend.

## Configuration (env vars)

| Var | Default | Meaning |
|---|---|---|
| `CHARGER_ID` | *(required)* | Pre-enrolled charger identity name, e.g. `charger1` |
| `READING_INTERVAL_MS` | `15000` | On-ledger meter reading interval |
| `STOP_POLL_INTERVAL_MS` | `3000` | How often to check whether the session was stopped externally |
| `ADMIN_PORT` | `4001` | Local plug-in/unplug trigger API port |
| `CHANNEL_NAME` | `mychannel` | Fabric channel |
| `CHAINCODE_NAME` | `marketplace` | Chaincode name |
| `MSP_ID` | `Org1MSP` | MSP the charger identity belongs to |
| `PEER_ENDPOINT` | `localhost:7051` | Fabric peer gRPC endpoint |
| `PEER_HOST_ALIAS` | `peer0.org1.example.com` | TLS SNI override for the peer |
| `IDENTITIES_DIR` | `../gateway/identities` | Where pre-enrolled MSP material lives |
| `PEER_TLS_CERT_PATH` | test-network Org1 tlsca cert | Peer TLS root cert |
