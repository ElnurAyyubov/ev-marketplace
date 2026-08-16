# EV Charging Marketplace

A decentralized EV charging marketplace built on **Hyperledger Fabric**. The platform allows drivers to discover charging stations, reserve charging slots, start charging sessions, and pay for the energy they consume.

Charging is supported for both **commercial** and **residential** providers. Residential providers can require approval before a reservation is confirmed.

The project also includes smart-charger metering, trip planning, location-based filtering, natural-language search, voice search, and self-provisioning deployment.

## Features

* **Charging marketplace**

  * Browse commercial and residential charging providers
  * Interactive map and list views
  * Filter by charger type, price, approval requirement, and distance
  * Natural-language search

* **Reservations**

  * Reserve individual charging slots
  * Pre-authorize the estimated charging cost
  * Automatic slot exclusivity through time-based booking keys
  * Provider approval workflow for residential chargers

* **Smart-charger metering**

  * Each charger has its own Fabric identity
  * Chargers submit signed cumulative meter readings
  * Meter readings are validated on-chain
  * Charging sessions are tied to a specific charger

* **Settlement**

  * Funds are held when a reservation is confirmed
  * Final cost is calculated from the charger's last on-ledger meter reading
  * Unused funds are returned to the driver
  * Delivered energy is never entered manually by the driver or provider

* **Trip planning**

  * Plan a route between an origin and destination
  * Suggest charging stops based on a maximum leg distance
  * Supports both structured input and natural-language requests
  * Planning is read-only and does not create reservations

* **Driver location**

  * Set the driver's position manually or through browser geolocation
  * Display the driver on the marketplace map
  * Filter providers by distance
  * Location is kept outside the Fabric ledger

* **Natural-language search**

  * Convert free-text requests into marketplace filters
  * Uses the same search and filtering mechanism as the regular UI

* **Voice search**

  * Push-to-talk search from the marketplace
  * Converts speech into the same marketplace filters used by text search
  * Supports charger type, price, approval requirement, and distance

* **Self-provisioning deployment**

  * Docker-based deployment for physical devices
  * Device identity can be created during first boot
  * One-time provisioning credentials are removed after registration

## Architecture

The browser communicates with a dedicated gateway rather than directly with the Fabric network.

```text
Frontend
   │
   ▼
User Gateway
   │
   ▼
Hyperledger Fabric
   │
   ├── Users
   ├── Providers
   ├── Reservations
   ├── Chargers
   ├── Charging Sessions
   ├── Meter Readings
   └── Token Balances
```

Each gateway is associated with a single Fabric identity and holds the corresponding private key. This keeps Fabric credentials and peer communication out of the browser.

Smart chargers follow the same identity model. A charger uses its own certificate to start charging sessions and submit meter readings.

## Metering and Settlement

The charging flow is based on cumulative meter readings recorded on the ledger.

When a reservation is confirmed, the estimated amount is placed on hold:

```text
requestedEnergy × pricePerKWh
```

During the charging session, the charger periodically submits signed cumulative readings.

When charging stops:

```text
lastMeterReading - initialMeterReading
                    │
                    ▼
             Energy consumed
                    │
                    ▼
              Final cost
```

The provider receives the final amount and any remaining part of the reservation hold is returned to the driver.

The implementation assumes that the physical charging device provides trustworthy measurements and protects its private key. Hardware certification, sealed firmware, and physical anti-tampering are outside the scope of this project.

## Identity Model

Fabric identities are separated by responsibility:

| Identity       | Purpose                                                     |
| -------------- | ----------------------------------------------------------- |
| `admin`        | Fabric CA bootstrap/registration identity                   |
| `minteradmin`  | Minting marketplace tokens                                  |
| `carregistrar` | Registering client identities for self-provisioning devices |
| User           | Driver or provider interacting with the marketplace         |
| Charger        | Authenticate charging sessions and submit meter readings    |

A user's identity is created automatically when `run-user.sh` is first started with that username.

There is no shared gateway or identity selector in the frontend. Each frontend instance communicates with the gateway for exactly one identity.

## Location Privacy

Driver location is deliberately kept outside the blockchain.

Distance filtering is performed on the client side using the driver's location and the provider list. Coordinates are not sent to Fabric peers as query parameters and are not written to the ledger.

The location can be changed through:

* Browser geolocation
* Map interaction
* Latitude/longitude inputs
* `set-location.sh`

## Trip Planner

The Trip Planner generates an ordered list of charging stops between an origin and destination.

The planner uses a configurable maximum leg distance, with a default of **300 km**.

It is deterministic and read-only: it does not reserve charging stations or maintain trip state.

Natural-language requests are parsed into the planner's structured input before the route is generated.

## Voice Search

The marketplace includes a push-to-talk search interface.

For example:

```text
residential chargers under 30 within 10 km, no approval
```

is converted into the corresponding marketplace filters before the query is executed.

Voice recognition uses a local `whisper-server` based on `whisper.cpp`. `ffmpeg` is required for audio processing.

When voice recognition is unavailable, the endpoint fails rather than executing an unrestricted search.

## Running the Project

### Requirements

* Docker + Docker Compose
* JDK 11+
* Node.js 18+
* npm
* `jq`
* Hyperledger Fabric 2.5.x binaries
* `fabric-samples`

The repository expects `fabric-samples` at the project root.

Install the Fabric binaries and samples with:

```bash
curl -fsSL --max-time 30 \
  https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh \
  -o install-fabric.sh

chmod +x install-fabric.sh
./install-fabric.sh docker binary samples
```

### Start the Fabric network

```bash
./network/up.sh
```

### Deploy the chaincode

```bash
./network/deployCC.sh
```

### Enroll the Fabric admin

```bash
export PATH=$PATH:$(pwd)/fabric-samples/bin

fabric-ca-client enroll \
  -u https://admin:adminpw@localhost:7054 \
  --caname ca-org1 \
  -M "$(pwd)/gateway/identities/admin/msp" \
  --tls.certfiles \
  "$(pwd)/fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem"
```

### Create the required identities

```bash
./scripts/enroll-identity.sh minteradmin
./scripts/enroll-car-registrar.sh
```

### Start a user

```bash
./scripts/run-user.sh alice 3001 5174
```

A second user can be started on different ports:

```bash
./scripts/run-user.sh provider1 3002 5175
```

### Add test funds

```bash
./scripts/faucet.sh alice 500
```

### Start a charger simulator

First enroll the charger:

```bash
./scripts/enroll-charger.sh charger1
```

Then start the simulator:

```bash
cd charger-sim
npm install

CHARGER_ID=charger1 ADMIN_PORT=4001 npm run dev
```

## Demo Flow

A complete local demo can be run with a driver, a provider, and a simulated charger.

1. Register the users.
2. Create a commercial or residential charging provider.
3. Register a charger against one of the provider's slots.
4. Enroll the charger's Fabric identity.
5. Start the charger simulator.
6. Add funds to the driver account.
7. Find the charger through the marketplace.
8. Reserve an available slot.
9. Approve the reservation if the provider requires approval.
10. Start the simulated charging session.
11. Observe meter readings and the running charging cost.
12. Stop charging.
13. Settle the session from the recorded meter readings.

For a residential provider, the reservation remains pending until the provider approves it.

## Project Structure

```text
.
├── chaincode/
│   └── marketplace/       # Fabric chaincode
├── charger-sim/           # Smart-charger simulator
├── frontend/              # Web frontend
├── gateway/               # Gateway API
├── network/               # Fabric network scripts
├── scripts/               # Setup and utility scripts
├── Dockerfile
└── docker-compose.example.yml
```

## Chaincode

The chaincode is implemented in Java using the Fabric Contract API and is built using the Gradle wrapper included in the repository.

The main contract is located at:

```text
chaincode/marketplace/src/main/java/marketplace/SmartContract.java
```

The contract handles:

* User registration
* Provider registration
* Charger registration
* Reservations
* Token balances
* Charging sessions
* Meter readings
* Settlement
* Charger status

## Limitations

This is a prototype implementation rather than a production payment or charging platform.

Some current limitations include:

* Token balances are implemented as mutable ledger counters rather than event-sourced accounting.
* Identities are currently provisioned through a single Fabric organization.
* User private keys are held by the gateway process.
* Smart-charger hardware security is assumed rather than implemented.
* The charger malfunction mechanism does not provide an on-chain dispute-resolution process.
* The current implementation has not been hardened for production-scale concurrent workloads.

## Status

The main charging lifecycle is implemented end-to-end:

**Marketplace → Reservation → Approval → Charging → Metering → Settlement**
