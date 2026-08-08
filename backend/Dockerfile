# Asset backend — single Node/TS service (fastify + better-sqlite3 + viem).
# SQLite lives in /app/data: mount a persistent volume there or the DB resets
# on every deploy (bind sessions / reward idempotency / attestation queue).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilds for node 22; fall back to source build if absent.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci \
    && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/data
# Configuration comes entirely from env vars (see .env.example) — no .env is baked in.
EXPOSE 8787
ENV HOST=0.0.0.0
CMD ["npm", "run", "start"]
