FROM node:20-slim

# Install Chromium (for puppeteer-core)
RUN apt-get update && \
    apt-get install -y chromium && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json .
RUN npm ci
COPY . .

CMD ["node", "index.js"]
