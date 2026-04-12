# ─────────────────────────────────────────────────────────────────────────────
# GhostLayer Local Agent – Production Dockerfile
#
# Multi-stage build:
#   builder  – installs all dependencies (including native-module build tools)
#   runner   – lean production image with only runtime artifacts
#
# Usage (standalone):
#   docker build -t ghostlayer-agent .
#   docker run -p 4000:4000 \
#              -e API_KEY=<your-key> \
#              -e SERVER_URL=https://your-ghostlayer.example.com \
#              -v $(pwd)/corporate_data:/data:ro \
#              ghostlayer-agent
#
# For the full stack (agent + Redis + Qdrant) use docker-compose.yml.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install build tools required by native modules (better-sqlite3, canvas, etc.)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first so Docker can cache this layer
COPY package.json package-lock.json ./

# Install all dependencies (including devDeps needed by native compilers).
# Do NOT use --omit=optional here; optional native addons must compile in the
# builder stage so that the compiled binaries are available in the runner stage.
RUN npm ci

# ── Stage 2: runner ──────────────────────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

# Install only the runtime system libraries that native modules link against
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for container security
RUN groupadd --gid 1001 ghostlayer && \
    useradd  --uid 1001 --gid ghostlayer --shell /bin/sh --create-home ghostlayer

# Copy compiled node_modules from the builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY . .

# Make the entrypoint executable
RUN chmod +x docker-entrypoint.sh

# Create the default scan directory and data dirs; give the runtime user ownership
RUN mkdir -p /data /app/.cache && \
    chown -R ghostlayer:ghostlayer /app /data

USER ghostlayer

# ── Configuration ────────────────────────────────────────────────────────────

# Local extension API port
EXPOSE 4000

# Environment variables (can be overridden at runtime)
# Required:
ENV API_KEY=""
# Optional:
ENV SERVER_URL=""
ENV SCAN_DIR="/data"
ENV LOCAL_PORT="4000"
ENV VERBOSE="false"
# Redis / Qdrant service addresses (matches docker-compose service names)
ENV REDIS_URL="redis://redis:6379"
ENV QDRANT_URL="http://qdrant:6333"
# Cache Transformers.js models inside the container's persistent data directory
ENV TRANSFORMERS_CACHE="/app/.cache"

ENTRYPOINT ["./docker-entrypoint.sh"]
