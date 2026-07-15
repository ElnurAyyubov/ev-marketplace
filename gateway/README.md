# EV Charging Marketplace — Gateway

REST service bridging the frontend to the Hyperledger Fabric chaincode. See
the repo root `README.md` for full setup (network bootstrap, identity
enrollment, running the frontend). This file documents gateway-specific
pieces that don't belong at the repo root.

## Natural-language search (`POST /search/nl`)

Accepts free text (`{ "query": "commercial charger, no approval, under 25" }`)
and returns the same provider result shape as the deterministic `/providers`
search. The LLM's only job is translating English into query fields — it
never computes results, ranks providers, or touches the ledger. Every result
still comes from the existing `QueryProviders` chaincode function, unchanged.

```
free text --> Ollama (local) --> raw JSON (untrusted)
                                       │
                                       ▼
                              sanitizeSelector()  (mandatory whitelist)
                                       │
                                       ▼
                    QueryProviders (existing chaincode fn, unchanged)
```

`sanitizeSelector()` (`src/nlSearch/sanitize.ts`) is the mandatory boundary
between model output and the database query. It forces `docType`/`status`,
whitelists only `providerType`, `approvalRequired`, and `pricePerkWh`
bounds, and drops everything else — including a `maxPricePerkWh`/
`minPricePerkWh` of `0`, negative, or non-integer, which is treated as "no
price constraint" rather than passed through as `pricePerkWh: {$lte: 0}`
(a real failure mode where a model emits `0` as an "unset" placeholder).

### Requirements

This endpoint calls a **local** Ollama instance — no hosted LLM API, no
network egress, no API key. Install Ollama and pull the model before
starting the gateway:

```bash
ollama pull qwen2.5:3b-instruct
ollama serve   # if not already running as a service
```

### Config

| Env var         | Default                   | Purpose                          |
|------------------|---------------------------|-----------------------------------|
| `OLLAMA_URL`     | `http://localhost:11434`  | Base URL of the Ollama server     |
| `OLLAMA_MODEL`   | `qwen2.5:3b-instruct`     | Model tag to call via `/api/chat` |

Both have working defaults for a local install; set them in `.env` only to
point at a different host or model (see `.env.example`).

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
