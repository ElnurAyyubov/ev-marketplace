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

## Voice search (`POST /search/voice`)

See `VOICE_INPUT_ADDENDUM.md` at the repo root for the full design. Push-to-talk
voice input into the marketplace filter controls only — a microphone button on
`MarketplacePage`, English-only, exactly four extractable fields
(`providerType`, `approvalRequired`, `maxPricePerkWh`, `radiusKm`). Read-only
by construction: this endpoint returns `{ transcript, filters, source: 'rules'
| 'llm', nearbyApplied }`, never providers — same contract as `/search/nl`,
just fed by a recorded clip.

```
mic ──► whisper-server (local) ──► transcript (untrusted text)
                                          │
                              parseVoiceFilters()  (deterministic, unit-tested)
                                          │
                          ┌───────────────┴───────────────┐
                    matched ≥ 1                     matched = 0
                          │                                │
                          │                    existing Ollama NL parse
                          └───────────────┬────────────────┘
                                          ▼
                       { filters } returned to the frontend
                                          │
        frontend fills in Type/Price/Approval/Within-km, calls GET /providers
```

### Two deployment paths for `whisper-server`

whisper.cpp runs as a resident local HTTP server, the same deployment shape
as Ollama — model held in RAM between requests, `WHISPER_URL` points at it.
Which one applies depends on how you're running the gateway:

- **`scripts/run-user.sh` (bare host process).** There is no host-level
  whisper-server unless you start one yourself — see "Host setup" below.
  `WHISPER_URL` defaults to `http://localhost:8080`.
- **The self-provisioning car container (`Dockerfile`,
  `docker-compose.example.yml`).** whisper.cpp is built from source and
  baked into the image itself (see the `whisper-build` stage in the root
  `Dockerfile`), and `entrypoint.sh` starts it as a sibling process inside
  each car's own container, bound to that container's own `127.0.0.1`. **No
  setup step, no host dependency, nothing to run separately.** This was
  verified directly during development: with the *host's* whisper-server
  killed outright, `POST /search/voice` against a running car container
  (`dapp-car-1-1`) still returned a correct `200` with `source: "rules"` —
  the container genuinely carries its own complete copy, matching the "one
  car, one complete copy of everything" model
  `CONTAINER_PROVISIONING_ADDENDUM.md` is built on. Ollama (NL search, trip
  planner, and voice's own LLM fallback) deliberately stays a *shared* host
  service reached via the existing `extra_hosts: "localhost:host-gateway"`
  trick — baking in a ~1.8 GB LLM per car is a much bigger commitment than
  this ~150 MB ASR model; see `TECHNICAL_OVERVIEW.md` §19 for the full
  numbers and reasoning behind drawing the line there.
  - Image cost: ~150 MB (binary + shared libs + `ggml-base.en.bin`, copied
    from a `node:20-slim` build stage — matching the runtime stage's glibc
    is required, a host-built binary is not portable in). RAM cost while
    running: ~280 MB resident.
  - `VOICE_ENABLED=false` skips starting it in the container too, saving
    that RAM/CPU for a car that doesn't want voice search.
  - Same-container sanity check:
    `docker exec <car-container> node -e "fetch('http://localhost:8080/inference').then(r=>console.log(r.status))"`
    should print `404` (a GET against a POST-only route reaching the server
    counts as reachable), not a connection error.

### Host setup (for `run-user.sh`, or to reproduce the container's build)

Not built or downloaded as part of this repo (the model is ~148 MB and this
is a dev/demo setup step, same as installing Ollama):

```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp && cmake -B build && cmake --build build -j4
./models/download-ggml-model.sh base.en
sha256sum models/ggml-base.en.bin       # record this below once you've built it

./build/bin/whisper-server -m models/ggml-base.en.bin -t 4 --port 8080 --host 127.0.0.1
```

- **Model: `ggml-base.en`.** `tiny.en` is faster but materially worse;
  `small.en` is better but too slow on a CPU-only 4-core.
- **`ggml-base.en.bin` SHA256:**
  `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`
  (whisper.cpp commit `8631825d41a2712268813981a9550b04a3f225e5`, downloaded
  from `https://huggingface.co/ggerganov/whisper.cpp` via
  `models/download-ggml-model.sh base.en` on 2026-08-07). Re-verify with
  `sha256sum models/ggml-base.en.bin` if reproducing — see
  `VOICE_INPUT_ADDENDUM.md` §9.
- **No GPU, no internet.** Zero network egress. The offline boundary in
  `TECHNICAL_OVERVIEW.md` §17 is unchanged — Nominatim/OSRM remain the only
  real internet dependencies, both confined to the trip planner.
- Grammar-constrained decoding is deliberately not used (`--grammar` is
  CLI-only, not exposed by `whisper-server`); free transcription plus the
  deterministic parser is more robust to phrasing variation.
- `ffmpeg` is a required prerequisite (transcodes the browser's recorded
  clip to 16kHz mono PCM before it reaches whisper-server) — install it on
  the host for local dev; the root `Dockerfile` installs it for the
  container path.

If `whisper-server` isn't reachable, `POST /search/voice` returns a clean
`502` — same fail-closed rule as `/search/nl`: no error path here ever falls
through to an unsanitized or unfiltered query (this endpoint never queries
anything at all; worst case it returns an error and the frontend's existing
filter state is untouched).

**Running `whisper-server` in the background (host / `run-user.sh` path only
— the container path starts its own automatically, see above):**

```bash
cd whisper.cpp
nohup ./build/bin/whisper-server -m models/ggml-base.en.bin -t 4 --port 8080 --host 127.0.0.1 > /tmp/whisper.log 2>&1 &
```

`--host 127.0.0.1` is correct here since `run-user.sh` and this
whisper-server run as plain processes on the same machine, talking over the
real loopback interface — no container networking involved. (An earlier
version of this doc had `--host 0.0.0.0` here as a workaround for reaching a
*host-level* whisper-server from inside a container; that whole class of
problem doesn't apply anymore now that the container path bakes its own
whisper-server in — see "Two deployment paths" above.)

### Privacy: radiusKm is a scalar, never a coordinate

The deterministic parser (`src/voice/parseFilters.ts`) applies a
`VOICE_NEARBY_RADIUS_KM` (default 25) default radius whenever an utterance
matched something but named no explicit distance — see
`VOICE_INPUT_ADDENDUM.md` §3 Rule 2. This radius is a **scalar only**.

Per `CAR_LOCATION_ADDENDUM.md` §2.1/§9, the driver's location is never sent
to a Fabric peer as a query parameter, and server-side bounding-box radius
filtering driven by the car's position is explicitly out of scope. So unlike
the addendum's original design (which routed `radiusKm` into a
`QueryProviders` bounding box), this implementation applies it to the
marketplace's existing **client-side** "within X km" filter — the same one
`CAR_LOCATION_ADDENDUM.md` already built. `sanitizeSelector()` still
whitelists/clamps `radiusKm` (1–200) as defense-in-depth on the parser's own
output, but nothing in this codebase ever attaches it to a chaincode query.
If the frontend has no resolved car location yet, the radius is dropped and
the UI shows a "nearby unavailable — showing all" chip instead of silently
applying (or silently not applying) a filter.

### Secure-context requirement

`getUserMedia` needs HTTPS or `localhost`. The `run-user.sh` dev path
(`localhost:5174`) is fine. A container frontend opened from another
machine by IP will silently have no microphone — the mic button hides
itself when `navigator.mediaDevices` is undefined rather than throwing.

### Config

| Env var | Default | Meaning |
|---|---|---|
| `WHISPER_URL` | `http://localhost:8080` | whisper-server base URL — `localhost`, not `127.0.0.1`, so it resolves correctly whether whisper-server is a plain host process or (in the container path) baked into the same container |
| `VOICE_NEARBY_RADIUS_KM` | `25` | Rule 2 default radius |
| `VOICE_MAX_SECONDS` | `15` | hard cap on clip length (enforced by ffmpeg) |
| `VOICE_ENABLED` | `true` | when `false`, the route is never mounted (`POST /search/voice` 404s) |

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
