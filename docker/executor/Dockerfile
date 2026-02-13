# Executor Service Dockerfile
# Contains: Xvfb, Chrome, VNC server, websockify, Playwright, dappwright
FROM mcr.microsoft.com/playwright:v1.51.0-jammy

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99
ENV VNC_PORT=5900
ENV WEBSOCKIFY_PORT=6080
ENV SCREEN_WIDTH=1280
ENV SCREEN_HEIGHT=720
ENV SCREEN_DEPTH=24
ENV NODE_ENV=production

# Install VNC server and dependencies
RUN apt-get update && apt-get install -y \
    x11vnc \
    xvfb \
    fluxbox \
    supervisor \
    websockify \
    python3 \
    python3-numpy \
    wget \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Download noVNC for web-based VNC viewing
RUN mkdir -p /app/novnc && \
    wget -qO- https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz | \
    tar xz --strip-components=1 -C /app/novnc && \
    ln -sf /app/novnc /usr/share/novnc

WORKDIR /app

# ─────────────────────────────────────────────────────────────────
# Copy dappwright-test (test runner base with wallet fixtures)
# No cache build needed — dappwright downloads MetaMask at runtime
# ─────────────────────────────────────────────────────────────────
COPY dappwright-test/package.json ./dappwright-test/
COPY dappwright-test/tsconfig.json ./dappwright-test/
COPY dappwright-test/playwright.config.ts ./dappwright-test/
COPY dappwright-test/environment.d.ts ./dappwright-test/
COPY dappwright-test/fixtures ./dappwright-test/fixtures
COPY dappwright-test/test ./dappwright-test/test

WORKDIR /app/dappwright-test
RUN npm install

# Default seed phrase - override SEED_PHRASE at runtime if needed
ARG SEED_PHRASE="test test test test test test test test test test test junk"
ENV SEED_PHRASE=${SEED_PHRASE}

# Optional: pre-download MetaMask extension to avoid GitHub rate limits at runtime
ARG GITHUB_TOKEN=""
ENV GITHUB_TOKEN=${GITHUB_TOKEN}
RUN xvfb-run --auto-servernum npx playwright install chromium || echo "Chromium install completed"

# ─────────────────────────────────────────────────────────────────
# Copy and build translator package (needed by executor for self-heal)
# ─────────────────────────────────────────────────────────────────
WORKDIR /app
COPY packages/translator/package.json ./packages/translator/
COPY packages/translator/tsconfig.json ./packages/translator/

WORKDIR /app/packages/translator
RUN npm install --include=dev

COPY packages/translator/src ./src
COPY packages/translator/knowledge ./knowledge
RUN npm run build

# ─────────────────────────────────────────────────────────────────
# Copy executor package (worker + runner that orchestrates tests)
# ─────────────────────────────────────────────────────────────────
WORKDIR /app
COPY packages/executor/package.json ./packages/executor/
COPY packages/executor/tsconfig.json ./packages/executor/

WORKDIR /app/packages/executor
RUN npm install --include=dev

# Link translator package so executor can import @web3-test/translator
RUN mkdir -p node_modules/@web3-test && ln -sf /app/packages/translator node_modules/@web3-test/translator

COPY packages/executor/src ./src
RUN npm run build

# Copy Prisma schema for client generation
COPY packages/api/prisma ./prisma
RUN ./node_modules/.bin/prisma generate

# ─────────────────────────────────────────────────────────────────
# Setup runtime directories and scripts
# ─────────────────────────────────────────────────────────────────
WORKDIR /app
RUN mkdir -p /app/artifacts /app/cache /var/log/supervisor /app/generated-tests

# Copy supervisor config
COPY docker/executor/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy startup script
COPY docker/executor/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# VNC password (default: secret, can be overridden)
ENV VNC_PASSWORD=secret
ENV DAPPWRIGHT_TEST_DIR=/app/dappwright-test
# Generated tests placed in test/playwright/ directly
ENV GENERATED_TESTS_DIR=/app/dappwright-test/test/playwright
ENV ARTIFACTS_PATH=/app/artifacts

EXPOSE 5900 6080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:6080 || exit 1

CMD ["/app/start.sh"]
