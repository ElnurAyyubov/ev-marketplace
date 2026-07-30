# EV Charging Marketplace — Gateway

REST service bridging the frontend to the Hyperledger Fabric chaincode. See
the repo root `README.md` for full setup (network bootstrap, identity
enrollment, running the frontend). This file documents gateway-specific
pieces that don't belong at the repo root.

## Natural-language search (`POST /search/nl`)

Accepts free text (`{ "query": "commercial charger, no approval, under 25" }`)
and returns `{ "filters": { type?, minPrice?, maxPrice?, approvalRequired? } }`
— the same shape as the marketplace page's own filter inputs. The LLM's only
job is translating English into those filter values; it never computes
results, ranks providers, or touches the ledger itself. The frontend
populates its Type/Price/Approval inputs from the response and runs the
existing, deterministic `GET /providers` search (which calls `QueryProviders`
unchanged) to actually fetch results.

```
free text --> Ollama (local) --> raw JSON (untrusted)
                                       │
                                       ▼
                              sanitizeSelector()  (mandatory whitelist)
                                       │
                                       ▼
                     { filters } returned to the frontend
                                       │
                                       ▼
        frontend fills in Type/Price/Approval inputs, calls GET /providers
                    (existing chaincode fn, unchanged)
```

`sanitizeSelector()` (`src/nlSearch/sanitize.ts`) is the mandatory boundary
between model output and the filter values returned to the frontend. It
forces `docType`/`status`, whitelists only `providerType`, `approvalRequired`,
and `pricePerkWh` bounds, and drops everything else — including a
`maxPricePerkWh`/`minPricePerkWh` of `0`, negative, or non-integer, which is
treated as "no price constraint" rather than passed through as
`pricePerkWh: {$lte: 0}` (a real failure mode where a model emits `0` as an
"unset" placeholder).

## Trip planner (`POST /trip/plan`, `POST /trip/plan/nl`)

Read-only, advisory routing over the same marketplace data — see
`TRIP_PLANNER_ADDENDUM.md` at the repo root for the full design. `POST
/trip/plan` takes `{ origin, destination, maxLegKm?, constraints? }` (each of
`origin`/`destination` either `{lat,lng}` or a place-name string) and returns
a `TripPlan`: an ordered list of charging stops such that no leg exceeds
`maxLegKm` (default 300 km), computed by a deterministic greedy walk
(`src/tripPlanner/planner.ts`) over haversine distance — never a live battery
model, never randomness. `POST /trip/plan/nl` takes `{ query }`, parses it
with the same local-Ollama + `sanitizeSelector()` machinery as NL search
(`src/tripPlanner/nlPlan.ts`), runs the same planner, and optionally attaches
an LLM narration (`src/tripPlanner/narrate.ts`) of the finished plan.

The model never picks stations, orders stops, or judges feasibility — it
only turns English into a structured request at the front edge and a
finished plan into prose at the back edge. `no_feasible_route` is a normal
`200` result (with a `reason` and the partial stops), not an HTTP error.
Place strings are geocoded via Nominatim (`src/tripPlanner/geocode.ts`); a
failed geocode is a `400` naming the unresolved string, never a guessed
coordinate. The planner never calls a chaincode *write* — `QueryProviders`
(`evaluateTransaction`) is its only ledger access, so reserving a suggested
stop stays the existing, separate, manual reservation flow.

### Requirements

Both NL endpoints above call a **local** Ollama instance — no hosted LLM
API, no network egress, no API key. Install Ollama and pull the model before
starting the gateway:

```bash
ollama pull qwen2.5:3b-instruct
ollama serve   # if not already running as a service
```

### Config

| Env var                     | Default                          | Purpose                                              |
|------------------------------|-----------------------------------|-------------------------------------------------------|
| `OLLAMA_URL`                 | `http://localhost:11434`         | Base URL of the Ollama server                         |
| `OLLAMA_MODEL`                | `qwen2.5:3b-instruct`             | Model tag to call via `/api/chat`                     |
| `NOMINATIM_URL`               | `https://nominatim.openstreetmap.org` | Geocoder used by the trip planner (place name -> lat/lng) |
| `NOMINATIM_MIN_INTERVAL_MS`   | `1000`                            | Minimum spacing between geocode requests (politeness) |
| `NOMINATIM_USER_AGENT`        | `ev-charging-marketplace-trip-planner/1.0` | Required identifying header for the public instance |
| `OSRM_URL`                    | `https://router.project-osrm.org` | Road-routing overlay for the trip planner (cosmetic only) |
| `TRIP_ROAD_OVERLAY`           | enabled                           | Set to `false` to disable the road overlay entirely   |

All have working defaults; set them in `.env` only to point at a different
host, model, or self-hosted instance (see `.env.example`).

### Failure behavior

If Ollama is unreachable, the response isn't valid JSON, or anything else
goes wrong, the endpoint returns a clean `502 { "error": ... }`. It never
falls through to an unsanitized or unfiltered query — a failed NL search
means no results, not "search everything."

### Determinism

The request pins `temperature: 0` and `seed: 42` for run-to-run stability
during development and demos. This is sufficient for local iteration but
**does not** guarantee bit-for-bit reproducibility across different hardware,
Ollama versions, or quantizations — only true batch-invariant/deterministic
kernels would, and that's out of scope here (an offline-eval concern, not
part of this endpoint).

**Model provenance:** because a model *tag* (e.g. `qwen2.5:3b-instruct`) can
point at different underlying weights over time (re-pulls, tag moves), record
the exact digest alongside any results you intend to reproduce or cite:

```bash
ollama show ${OLLAMA_MODEL:-qwen2.5:3b-instruct} --modelfile
# look for the line: FROM <name>@sha256:<digest>
```
