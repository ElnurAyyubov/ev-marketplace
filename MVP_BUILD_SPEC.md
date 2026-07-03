# EV Charging Marketplace — MVP Build Specification

> **Purpose of this file:** This is a build brief for an agentic coding assistant (Claude Code, running in a terminal). It defines the Minimum Viable Product for a decentralized marketplace for community-owned EV charging infrastructure, built on **Hyperledger Fabric**. It specifies scope, architecture, data models, function/API surfaces, and an ordered set of milestones with acceptance criteria. Build incrementally, milestone by milestone, and verify each before moving on.

---

## 0. How to use this document (instructions for Claude Code)

- **Build in milestone order (M0 → M5).** Do not scaffold the entire system at once. Complete and verify each milestone's acceptance criteria before starting the next.
- **After each milestone, run its verification steps and report results** before proceeding.
- **Ask before deviating from the tech stack or data model** defined here.
- **Do not build anything in the "Out of Scope" list (Section 9)** unless explicitly told to.
- **Milestone M6 (routing + LLM) is a stretch goal.** Stop after M5 and confirm the core loop works end-to-end before touching M6.
- Prefer small, working, testable increments over large speculative scaffolding.
- When a decision is genuinely ambiguous and not covered here, pause and ask rather than guessing.

---

## 1. Project context (one paragraph)

This is a decentralized marketplace where EV drivers can discover, reserve, use, and pay for charging services — from both **commercial charging stations** (companies, municipalities, universities, businesses, individuals) and **residential charging points** (private homeowners) — without a centralized intermediary. Both provider kinds are modeled as one generalized `ChargingProvider` entity distinguished by a `providerType` field, so future types (hotels, malls, workplaces, etc.) can be added without changing the core contract. Payment is settled through an **escrow mechanism** implemented in chaincode, which is also the project's answer to the "did the energy actually get delivered?" (oracle) problem. A fuller architecture and research-positioning document exists separately; this file is the implementation MVP only.

---

## 2. What the MVP must prove

The MVP is successful if a user can complete this **full loop** on a running Fabric network, through a web UI:

1. Register as a user.
2. Register a `ChargingProvider` — as either **Commercial** or **Residential** — with location, price, slots.
3. Search/filter providers (by type, price, and geographic proximity) and see them on a map.
4. Reserve a slot. If the provider is residential with `approvalRequired`, the reservation waits for owner approval; funds are held in **escrow**.
5. Start and complete a charging session; the provider reports delivered energy.
6. **Escrow settles automatically**: the provider is paid for actual energy delivered, the driver is refunded any difference, and balances update on-ledger.

Everything else is secondary to making this loop work reliably.

---

## 3. Scope (MoSCoW)

**MUST have (core loop):**
- Fabric network running with CouchDB state database.
- Chaincode (Go): users, generalized providers, slots, reservation state machine, sessions, fungible token + escrow settlement.
- Rich provider search (type, price range, geographic bounding box) via CouchDB queries.
- REST gateway service (Node + Fabric Gateway SDK) exposing the chaincode to the frontend.
- React + TypeScript frontend covering the full loop, with a map view.

**SHOULD have:**
- Residential manual-approval path with escrow held pending approval.
- Basic dispute flag on a completed session (does not need full resolution logic).
- Simple faucet/mint for demo funds.

**COULD have (only if core is solid):**
- Greedy trip-planning router (deterministic, no LLM) — Milestone M6.
- LLM natural-language layer over search and/or routing — Milestone M6, optional.
- IPFS upload for provider photos (field already exists; population optional).

**WON'T have in this MVP:** see Section 9.

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Blockchain | Hyperledger Fabric 2.5.x | Use the `test-network` from `fabric-samples` (2 orgs, 1 channel). |
| State DB | CouchDB | Required — enables rich JSON queries for provider search. |
| Chaincode | Go 1.21+ with `fabric-contract-api-go` | Package name: `marketplace`. |
| Gateway service | Node.js 18+, Express, `@hyperledger/fabric-gateway`, `@grpc/grpc-js` | The bridge between browser and Fabric. **Required** — see Section 5. |
| Frontend | React 18 + TypeScript + Vite | |
| Map | Leaflet + OpenStreetMap tiles | No API key needed; keep the MVP dependency-light. |
| Container runtime | Docker + Docker Compose | Prerequisite for the Fabric network. |

---

## 5. MVP architecture (and why the gateway service exists)

```
Browser (React + TS)
      │  HTTPS / REST + JSON
      ▼
Gateway Service (Node + Express + Fabric Gateway SDK)   ← holds X.509 identities, signs & submits txns
      │  gRPC (Fabric Gateway protocol)
      ▼
Fabric Peers  ──►  Chaincode (Go)  ──►  CouchDB (world state)
```

**Why the gateway service is mandatory (do not skip it):** Fabric authenticates clients with X.509 certificates issued by a CA, not with a browser-held keypair the way MetaMask works on Ethereum. A browser cannot securely hold Fabric enrollment credentials or speak the peer gRPC protocol directly. The gateway service holds the enrolled identities, signs transactions, and submits them to the peers. The React app only ever talks to this REST service. Any attempt to connect the browser straight to Fabric is incorrect for this stack.

**MVP identity simplification (state this in the code/README):** Instead of building full per-user Fabric-CA enrollment, the gateway pre-enrolls a small fixed set of identities (e.g., `admin`, `alice`, `bob`, `provider1`). The frontend has an "acting as" selector, and the gateway uses the matching identity for each request. Real per-user CA enrollment is post-MVP.

---

## 6. Repository structure (target)

```
ev-charging-marketplace/
├── README.md
├── network/                # scripts to bring up test-network + CouchDB, deploy chaincode
│   ├── up.sh
│   ├── down.sh
│   └── deployCC.sh
├── chaincode/
│   └── marketplace/        # Go chaincode
│       ├── main.go
│       ├── contract.go
│       ├── models.go       # structs: User, ChargingProvider, Slot, Reservation, Session, escrow
│       ├── providers.go
│       ├── reservations.go
│       ├── sessions.go
│       └── token.go
├── gateway/                # Node REST service
│   ├── src/
│   │   ├── index.ts
│   │   ├── fabric.ts       # Fabric Gateway connection + identity management
│   │   └── routes/
│   └── identities/         # pre-enrolled MSP material (gitignored)
└── frontend/               # React + TS + Vite
    └── src/
        ├── api/            # typed REST client
        ├── components/
        └── pages/
```

---

## 7. Data models (chaincode)

All records are stored in CouchDB world state with composite keys. Include a `docType` field on every record so CouchDB selector queries can filter by type.

**User** — key `user~{userId}` (`userId` = derived from client identity)
- `docType`, `userId`, `name`, `registered` (bool)

**ChargingProvider** — key `provider~{providerId}`
- `docType`, `providerId`, `ownerId`
- `providerType` (enum: `Commercial` | `Residential`; leave room for future values)
- `latitude`, `longitude` (integers, scaled by 1e6 — no floats)
- `locationLabel` (short human string)
- `pricePerkWh` (integer, in smallest token unit)
- `availableEnergy` (integer, kWh)
- `numberOfSlots`, `currentAvailableSlots`
- `connectorTypes` (array of strings)
- `approvalRequired` (bool)
- `status` (enum: `Active` | `Inactive`)
- `ipfsHash` (string, may be empty in MVP)

**Slot** — key `slot~{providerId}~{slotIndex}`
- `docType`, `slotId`, `providerId`, `occupied` (bool), `currentReservationId` (nullable)

**Reservation** — key `reservation~{reservationId}`
- `docType`, `reservationId`, `providerId`, `slotId`, `driverId`
- `requestedEnergy` (integer)
- `escrowAmount` (integer)
- `state` (see state machine below)
- `createdAt`, `expiresAt` (timestamps)

**Session** — key `session~{sessionId}`
- `docType`, `sessionId`, `reservationId`, `startTime`, `endTime`
- `deliveredEnergy` (integer)
- `settledAmount` (integer)
- `state` (enum: `Active` | `Completed` | `Disputed`)

**Token balance** — key `balance~{userId}` → integer.
> MVP uses a simple mutable balance. **Document in code** that the concurrency-safe, event-sourced balance model (settlements as immutable `{providerId}~{txId}` entries, balance computed by aggregation) is a known post-MVP hardening needed before real concurrent load.

**Escrow** — held implicitly inside the Reservation (`escrowAmount` + `state`); no separate escrow record needed for the MVP.

---

## 8. Reservation state machine

Implement this explicitly. Do not use a bare status string without enforced transitions.

```
                 approvalRequired?
CreateReservation ──── no ───►  CONFIRMED ──► (StartSession) ──► ACTIVE ──► (CompleteSession) ──► COMPLETED
        │                          ▲
        └──── yes ──► REQUESTED ────┘ (ApproveReservation)
                          │
                          └──► (reject / timeout) ──► CANCELLED / EXPIRED

Any of REQUESTED / CONFIRMED ──► (CancelReservation) ──► CANCELLED  (escrow refunded)
REQUESTED past expiresAt ──► EXPIRED (escrow refunded)
```

Escrow rules:
- Funds are **locked from the driver's balance into `escrowAmount`** the moment the reservation reaches `CONFIRMED` (immediately if no approval needed; on approval otherwise). If the driver's balance is insufficient, the reservation fails.
- `CANCELLED` / `EXPIRED` → escrow fully **refunded** to the driver.
- `CompleteSession` → escrow **settled**: provider paid `deliveredEnergy × pricePerkWh` (capped at `escrowAmount`), remainder refunded to driver.

Concurrency: prevent double-booking a slot. Under Fabric's optimistic concurrency (MVCC), a losing `CreateReservation` on an already-taken slot must fail cleanly (return an error) so the client can retry a different slot — it must not corrupt slot state.

---

## 9. Chaincode function surface (Go)

Implement these transaction functions. Caller identity (`userId`) is derived from the client certificate, not passed as an argument, except where an admin acts on behalf of setup.

**Users**
- `RegisterUser(name string) (User, error)`
- `GetUser(userId string) (User, error)`

**Providers**
- `RegisterProvider(providerJSON string) (providerId string, err error)` — also creates the N slot records.
- `GetProvider(providerId string) (ChargingProvider, error)`
- `UpdateProviderStatus(providerId string, status string) error` — owner only.
- `QueryProviders(selectorJSON string) ([]ChargingProvider, error)` — CouchDB rich query: filter by `providerType`, `pricePerkWh` range, and a lat/long bounding box. (Radius refinement can be done client-side after the bounding-box query.)
- `GetSlots(providerId string) ([]Slot, error)`

**Reservations**
- `CreateReservation(providerId, slotId string, requestedEnergy int) (reservationId string, err error)` — computes `escrowAmount`, locks escrow when it reaches `CONFIRMED`, marks slot occupied.
- `ApproveReservation(reservationId string) error` — provider owner only; `REQUESTED → CONFIRMED`; locks escrow.
- `CancelReservation(reservationId string) error` — refunds escrow, frees slot.

**Sessions**
- `StartSession(reservationId string) (sessionId string, err error)` — requires `CONFIRMED`; `→ ACTIVE`.
- `CompleteSession(sessionId string, deliveredEnergy int) error` — provider reports energy; settles escrow; frees slot; `→ COMPLETED`.
- `DisputeSession(sessionId string) error` — driver flags; `→ DISPUTED`; freeze settlement (manual/off-scope resolution for MVP).

**Token**
- `Mint(userId string, amount int) error` — admin/faucet only (dev).
- `GetBalance(userId string) (int, error)`
- `Transfer(to string, amount int) error` — optional in MVP.

---

## 10. REST API surface (gateway service)

Thin, typed wrappers over the chaincode. All requests carry an `X-Identity` header selecting the pre-enrolled identity to act as (MVP simplification).

```
POST   /users/register          { name }
GET    /users/:id

POST   /providers               { providerType, lat, lng, locationLabel, pricePerkWh,
                                  availableEnergy, numberOfSlots, connectorTypes[],
                                  approvalRequired }
GET    /providers               ?type=&minPrice=&maxPrice=&lat=&lng=&radiusKm=
GET    /providers/:id
PATCH  /providers/:id/status    { status }
GET    /providers/:id/slots

POST   /reservations            { providerId, slotId, requestedEnergy }
POST   /reservations/:id/approve
POST   /reservations/:id/cancel

POST   /sessions                { reservationId }               # start
POST   /sessions/:id/complete   { deliveredEnergy }
POST   /sessions/:id/dispute

GET    /balance/:userId
POST   /faucet                  { userId, amount }              # dev only

# --- M6 stretch, only if built ---
POST   /route/plan              { origin, destination, batteryPct, vehicleRangeKm, constraints }
POST   /search/nl               { query }                        # LLM → structured provider query
```

---

## 11. Frontend scope (React + TS)

Pages/flows for the core loop only:
- **Identity bar:** "acting as" selector (admin/alice/bob/provider1), current balance display, faucet button (dev).
- **Register user** form.
- **Create provider** form: a `providerType` toggle that reveals the right fields (residential defaults to 1 slot and exposes `approvalRequired`; commercial exposes multi-slot + connector types). Location set via a Leaflet map click → lat/long.
- **Marketplace / search:** filter by type, price range, and proximity; results shown as a list **and** as pins on a Leaflet map.
- **Provider detail + reserve:** pick a free slot, enter requested energy, reserve. If residential/approval-required, show "awaiting approval" state.
- **Provider owner view:** pending reservations with approve/reject; start/complete sessions with a delivered-energy input.
- **Reservation/session status view** for the driver, showing escrow held → settled/refunded.

Keep styling clean and functional; polish is not an MVP goal.

---

## 12. Build milestones & acceptance criteria

### M0 — Network up
- `network/up.sh` starts `test-network` with CouchDB and a channel; `down.sh` tears it down.
- **Accept:** `peer` containers and CouchDB are healthy; channel exists; a placeholder chaincode can be deployed and invoked once.

### M1 — Chaincode: users, providers, search
- Implement User + ChargingProvider models, `RegisterUser`, `RegisterProvider` (with slot creation), `GetProvider`, `GetSlots`, `QueryProviders`.
- **Accept:** via `peer chaincode invoke/query` (or a script), can register a user, register both a Commercial and a Residential provider, and retrieve them by a CouchDB query filtered by `providerType` and price range.

### M2 — Chaincode: reservations, slots, state machine
- Implement the reservation state machine, slot occupancy, `CreateReservation`, `ApproveReservation`, `CancelReservation`.
- **Accept:** a reservation on a residential provider enters `REQUESTED` and only becomes `CONFIRMED` after `ApproveReservation`; a commercial provider reservation goes straight to `CONFIRMED`; double-booking the same slot returns a clean error; cancel frees the slot.

### M3 — Chaincode: token, escrow, sessions, settlement
- Implement balances, `Mint`, escrow lock on confirm, `StartSession`, `CompleteSession` with settlement, `DisputeSession`.
- **Accept:** end-to-end on-ledger — mint funds to a driver, reserve (escrow locked, balance reduced), start + complete a session with `deliveredEnergy` less than reserved, and verify the provider is paid the correct amount and the driver refunded the remainder. Cancel path refunds fully.

### M4 — Gateway REST service
- Node + Fabric Gateway SDK connecting to the deployed chaincode; all endpoints in Section 10 (except M6); pre-enrolled identities with `X-Identity` selection.
- **Accept:** the full M3 loop is reproducible entirely through HTTP calls (documented in the README or a REST script/collection).

### M5 — Frontend (core loop) ← MVP DONE HERE
- React app implementing Section 11 against the gateway.
- **Accept:** a human can, in the browser, complete the full loop from Section 2 for both a commercial and a residential provider, including the residential approval path, watching escrow lock and settle. **This completing = MVP done.**

### M6 — STRETCH: routing + optional LLM (do not start until M5 is confirmed working)
- Deterministic greedy "farthest-feasible-station" planner over live provider data (see the design document). Deterministic core first.
- Optional: LLM layer that (a) parses a free-text trip request into the planner's structured constraints and narrates the result, and (b) translates free-text search into a structured provider query. The LLM must only orchestrate these deterministic calls — it must never compute routes or resolve anything financial itself.
- **Accept:** given an origin/destination/battery state, the planner returns an ordered, feasible list of charging stops (or a clean "no feasible route" message), reserving each stop and re-planning around a stop that becomes unavailable.

---

## 13. Out of scope for this MVP (do NOT build)

- Full multi-organization consortium network (test-network is sufficient).
- Full per-user Fabric-CA enrollment UX (pre-enrolled identities are used instead).
- Private data collections / selective location disclosure (post-MVP privacy feature).
- Smart-meter / hardware attestation of delivered energy (post-MVP oracle hardening).
- Full dispute-resolution logic and multi-org endorsement policy for disputes (MVP only *flags* disputes).
- Event-sourced concurrency-safe balances (MVP uses simple mutable balances; document the limitation).
- Reputation system, dynamic pricing, queue management (all future work).
- Mobile app, production deployment, real fiat on/off-ramp.

---

## 14. Definition of done (MVP)

- `network/up.sh` → `deployCC.sh` → start gateway → start frontend brings the whole system up locally with documented commands in the README.
- A user can complete the full loop (Section 2) in the browser for **both** a commercial and a residential provider, including the residential approval path.
- Escrow visibly locks on confirmation and settles correctly on session completion, with balances updating on-ledger.
- Double-booking and cancellation behave correctly.
- README documents prerequisites, setup, and how to run the demo loop.

---

## 15. Prerequisites (host machine)

- Docker + Docker Compose running.
- Go 1.21+, Node.js 18+, `jq`.
- `fabric-samples` with Fabric 2.5.x binaries installed (the standard `install-fabric.sh` script).
- Ports for peers, orderer, CouchDB, the gateway service, and the Vite dev server free.

> Start by confirming these prerequisites are present before M0. If Docker is not running or the Fabric binaries are missing, stop and report rather than attempting workarounds.
