# Self-provisioning car container: one gateway process + the built
# frontend, served on a single port. See CONTAINER_PROVISIONING_ADDENDUM.md.
# Build context must be the repo root (needs both gateway/ and frontend/):
#   docker build -f Dockerfile -t ev-charging-car .

# ---- frontend build ----
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Deliberately never sets VITE_USER_ID/VITE_GATEWAY_URL -- this bundle is
# generic, identity is resolved at runtime by ProvisioningGate.tsx.
RUN npm run build

# ---- gateway build ----
FROM node:20-slim AS gateway-build
WORKDIR /app/gateway
COPY gateway/package.json gateway/package-lock.json ./
RUN npm ci
COPY gateway/tsconfig.json ./
COPY gateway/src ./src
RUN npm run build

# ---- whisper.cpp build (voice search ASR, VOICE_INPUT_ADDENDUM.md) ----
# Built from source here, in the SAME base image as the runtime stage below
# (node:20-slim / Debian bookworm), rather than copied in from a host build --
# a binary built on a different glibc (e.g. a dev machine's Ubuntu) can fail
# to run against bookworm's glibc in the runtime stage. Baked into the image
# so each car container is self-sufficient for voice search: no host-level
# whisper-server, no extra_hosts trick, matches the "one car, one complete
# copy of everything" model CONTAINER_PROVISIONING_ADDENDUM.md is built on.
# Ollama (NL search, trip planner, voice's LLM fallback) deliberately stays
# a shared host service -- baking in a ~1.8GB LLM per car is a much bigger
# commitment than this ~150MB ASR model; see gateway/README.md "Voice search".
FROM node:20-slim AS whisper-build
RUN apt-get update && apt-get install -y --no-install-recommends \
      git cmake g++ make ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git
WORKDIR /opt/whisper.cpp
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build -j"$(nproc)" --target whisper-server
# base.en, not tiny.en/small.en: see gateway/README.md "Voice search" for why.
RUN ./models/download-ggml-model.sh base.en

# ---- runtime ----
# node:20-slim (Debian/glibc), NOT -alpine: fabric-ca-client below is a
# glibc-linked Go binary and will not run against Alpine's musl libc.
FROM node:20-slim AS runtime
# ffmpeg: transcodes uploaded voice clips to 16kHz mono PCM before they go to
# whisper-server. libgomp1: whisper-server's OpenMP runtime dependency (not
# pulled in by node:20-slim otherwise) -- see `ldd` on the built binary if
# this ever needs re-deriving.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/gateway
COPY gateway/package.json gateway/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=gateway-build /app/gateway/dist ./dist
COPY --from=frontend-build /app/frontend/dist ../frontend/dist
COPY gateway/docker/entrypoint.sh /app/entrypoint.sh

# whisper-server binary + its exact shared-lib deps (see `ldd`, not a glob --
# keeps the copy precise and the image from silently growing if whisper.cpp
# ever adds more example binaries to build/bin/) + the model. The binary's
# rpath is relative to its position in the build tree (build/bin/../lib-ish),
# not a portable $ORIGIN-same-dir lookup, so it does NOT resolve once copied
# flat into /app/whisper/ -- LD_LIBRARY_PATH below is what actually makes
# these resolve (confirmed: omitting it reproduces "cannot open shared
# object file: libwhisper.so.1" at container boot).
COPY --from=whisper-build /opt/whisper.cpp/build/bin/whisper-server /app/whisper/
COPY --from=whisper-build /opt/whisper.cpp/build/bin/libwhisper.so.1 /app/whisper/
COPY --from=whisper-build /opt/whisper.cpp/build/bin/libggml.so.0 /app/whisper/
COPY --from=whisper-build /opt/whisper.cpp/build/bin/libggml-base.so.0 /app/whisper/
COPY --from=whisper-build /opt/whisper.cpp/build/bin/libggml-cpu.so.0 /app/whisper/
COPY --from=whisper-build /opt/whisper.cpp/models/ggml-base.en.bin /app/whisper/models/ggml-base.en.bin
ENV LD_LIBRARY_PATH=/app/whisper

# Sourced from the local fabric-samples checkout (see root README
# Prerequisites) -- requires .dockerignore to re-include
# fabric-samples/bin/fabric-ca-client despite excluding the rest of
# fabric-samples/ from the build context.
COPY fabric-samples/bin/fabric-ca-client /usr/local/bin/fabric-ca-client
RUN chmod +x /usr/local/bin/fabric-ca-client /app/entrypoint.sh

# PEER_TLS_CERT_PATH / CA_TLS_CERT_PATH are deliberately NOT baked in here:
# the test-network's certs are dev-only, and a real network's certs belong
# to that deployment, not this generic image. Supply them at `docker run`
# time (mounted volume + matching env vars) -- see docker-compose.example.yml.
ENV IDENTITIES_DIR=/app/gateway/identities

EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
