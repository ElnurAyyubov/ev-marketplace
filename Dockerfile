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

# ---- runtime ----
# node:20-slim (Debian/glibc), NOT -alpine: fabric-ca-client below is a
# glibc-linked Go binary and will not run against Alpine's musl libc.
FROM node:20-slim AS runtime
WORKDIR /app/gateway
COPY gateway/package.json gateway/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=gateway-build /app/gateway/dist ./dist
COPY --from=frontend-build /app/frontend/dist ../frontend/dist
COPY gateway/docker/entrypoint.sh /app/entrypoint.sh

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
