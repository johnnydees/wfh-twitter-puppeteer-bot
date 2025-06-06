FROM node:20-slim

# ---- OS packages we need ----
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
          chromium \
          chromium-driver \
          build-essential \
          python3 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Puppeteer: tell it not to fetch its own Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# ---- install Node deps ----
COPY package.json .
RUN npm ci --omit=dev          # smaller image, no devDependencies

COPY . .

CMD ["node","index.js"]
