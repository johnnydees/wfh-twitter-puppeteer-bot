# ───────────────────────────────────────────────────────────────
# Dockerfile for wfh-twitter-puppeteer-bot
#   • Node 20 slim base
#   • Installs system Chromium + driver
#   • Installs only runtime (non-dev) node deps
#   • Sets env vars so puppeteer-core reuses the system browser
# ───────────────────────────────────────────────────────────────

FROM node:20-slim

# --- 1. OS-level packages ----------------------------------------------------
# • chromium & chromium-driver → the actual browser used by puppeteer-core
# • build tools & python3 → compile any native node addons
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        chromium \
        chromium-driver \
        build-essential \
        python3 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# --- 2. Puppeteer environment variables -------------------------------------
# Tell puppeteer-core to use the Chromium we just installed and
# skip its own download step (saves 100+ MB)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# --- 3. App setup ------------------------------------------------------------
WORKDIR /app

# Copy package manifest and install ONLY prod deps
COPY package.json ./
RUN npm install --omit=dev     # same effect as npm ci --production

# Copy the rest of the source (index.js, etc.)
COPY . .

# --- 4. Default command ------------------------------------------------------
CMD ["node", "index.js"]
