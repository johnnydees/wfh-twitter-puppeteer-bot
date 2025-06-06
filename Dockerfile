FROM node:20-slim

# --- OS packages: chromium & build tools ---
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        chromium chromium-driver \
        build-essential python3 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .

CMD ["node", "index.js"]
