# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim

LABEL maintainer="CES Team" \
      description="CMMC Level 2 Compliance Engine System (CES)"

ENV DEBIAN_FRONTEND=noninteractive \
    CES_PIPELINE_ROOT=/app/data \
    CES_ROOT=/app \
    PORT=4000 \
    EC_PORT=4001 \
    EC_HOST=0.0.0.0 \
    EO_PORT=5004 \
    CES_EO_BIND=0.0.0.0 \
    CES_AO_BIND=0.0.0.0 \
    CES_EO_OPERATOR_DEV_FALLBACK=1

# Install system dependencies, native compilation tools, supervisor, and sqlite3 CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    build-essential \
    python3 \
    git \
    supervisor \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install PowerShell Core 7 (and provide powershell.exe symlink for CES PowerShell adapters)
RUN curl -L -o /tmp/powershell.tar.gz https://github.com/PowerShell/PowerShell/releases/download/v7.4.6/powershell-7.4.6-linux-x64.tar.gz \
    && mkdir -p /opt/microsoft/powershell/7 \
    && tar -zxf /tmp/powershell.tar.gz -C /opt/microsoft/powershell/7 \
    && chmod +x /opt/microsoft/powershell/7/pwsh \
    && ln -s /opt/microsoft/powershell/7/pwsh /usr/bin/pwsh \
    && ln -s /opt/microsoft/powershell/7/pwsh /usr/bin/powershell \
    && ln -s /opt/microsoft/powershell/7/pwsh /usr/bin/powershell.exe \
    && ln -s /opt/microsoft/powershell/7/pwsh /usr/local/bin/powershell.exe \
    && rm -f /tmp/powershell.tar.gz

# Install global TypeScript and build utilities
RUN npm install -g typescript tsx vite

WORKDIR /app

# Copy application source
COPY . /app

# Configure supervisor & entrypoint
RUN chmod +x /app/docker/entrypoint.sh \
    && cp /app/docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf \
    && mkdir -p /app/data /app/out /var/log/supervisor

# Build all components in the exact dependency order (per BUILD-ORDER.md)
# 1. ces-tenant
RUN cd /app/ces/ces-tenant && npm ci --include=dev --no-audit --no-fund && npm run build

# 2. ces workspace root and members
RUN cd /app/ces && npm ci --include=dev --no-audit --no-fund
RUN cd /app/ces && npm run build -w ces-shared
RUN cd /app/ces && npm run build -w ces-ui-kit
RUN cd /app/ces && npm run build -w ces-stamper
RUN cd /app/ces && npm run build -w ces-eo
RUN cd /app/ces && npm run build -w ces-ao
RUN cd /app/ces && npm run build -w ces-ec
RUN cd /app/ces && npm run build -w ces-stamper-ui
RUN cd /app/ces && npm run build -w ces-ao-ui
RUN cd /app/ces && npm run build -w ces-eo-ui

# 3. Stacksim simulator & tester
RUN cd /app/ces/tenant-stacksim && npm ci --include=dev --no-audit --no-fund && npm run build
RUN cd /app/ces/ces-tester && npm ci --include=dev --no-audit --no-fund && npm run build

# Install Playwright Chromium + its system dependencies (needed by the Demo Commander)
RUN cd /app/ces/ces-tester && npx playwright install chromium --with-deps

# 4. Muster UI & Muster API
RUN cd /app/ces/ces-muster && npm ci --include=dev --no-audit --no-fund && npm run build
RUN cd /app/ces/ces-muster/muster-api && npm ci --include=dev --no-audit --no-fund && npm run build

# 5. Sync UI assets
RUN cd /app/ces && node scripts/sync-ui-assets.mjs

ENV NODE_ENV=production

# Ports exposed:
# 5173 - Muster UI
# 4000 - Muster API
# 5002 - Stamper GUI
# 5003 - AdminOps GUI
# 5004 - EvidenceOps GUI & API
# 4001 - Evidence Collector API
# 4390 - Tenant Stacksim
EXPOSE 4000 4001 4390 5002 5003 5004 5173 4600

VOLUME ["/app/data", "/app/out"]

ENTRYPOINT ["/app/docker/entrypoint.sh"]
