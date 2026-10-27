# Multi-stage production Dockerfile
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies needed for node-gyp and build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
COPY sql/ ./sql/
COPY public/ ./public/
COPY data/ ./data/

RUN npm run build

# Runtime Stage
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Install Playwright Chromium dependencies for live data extraction
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Install playwright chromium browser binary
RUN npx playwright install chromium

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/sql ./sql
COPY --from=builder /app/data ./data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/src/backend/server.js"]
