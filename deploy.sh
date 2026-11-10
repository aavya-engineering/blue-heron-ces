#!/usr/bin/env bash
# CES Remote Deployment Script
# Target: neele@136.108.118.191 (Path: /home/neele/project/CES)
set -e

REMOTE_USER="neele"
REMOTE_HOST="136.108.118.191"
REMOTE_DIR="/home/neele/project/CES"
SSH_KEY="${1:-id_ed25519}"

echo "=========================================================="
echo "  Deploying CES Stack to ${REMOTE_USER}@${REMOTE_HOST}"
echo "=========================================================="

SSH_OPTS="-o StrictHostKeyChecking=no"
if [ -f "$SSH_KEY" ]; then
    SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
elif [ -f "$HOME/.ssh/$SSH_KEY" ]; then
    SSH_OPTS="$SSH_OPTS -i $HOME/.ssh/$SSH_KEY"
elif [ -f "$HOME/.ssh/id_ed25519" ]; then
    SSH_OPTS="$SSH_OPTS -i $HOME/.ssh/id_ed25519"
fi

echo "==> 1. Testing SSH connectivity..."
ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "echo 'SSH connection successful. Server hostname:' \$(hostname)"

echo "==> 2. Stopping and taking down existing containers on remote server..."
ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "
if [ -d '${REMOTE_DIR}' ]; then
    cd ${REMOTE_DIR}
    docker compose -f docker-compose.yml -f docker-compose.ssl.yml down --remove-orphans 2>/dev/null || true
    docker compose down --remove-orphans 2>/dev/null || true
fi
docker rm -f ces-nginx-ssl ces-web ces-api ces-db ces-nginx ces-app 2>/dev/null || true
"

echo "==> 3. Ensuring remote directory exists..."
ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR}"

echo "==> 4. Syncing files to remote server..."
rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude '**/node_modules' \
    --exclude 'out' \
    --exclude '**/out' \
    --exclude '.git' \
    --exclude '**/.git' \
    --exclude '*.log' \
    --exclude 'dist' \
    --exclude '**/dist' \
    --exclude '.stacksim' \
    -e "ssh $SSH_OPTS" \
    ./ "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"

echo "==> 5. Building and starting CES Docker containers on remote server..."
ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "cd ${REMOTE_DIR} && \
    docker compose build && \
    docker compose up -d && \
    docker compose ps"

echo ""
echo "=========================================================="
echo "  CES Stack Successfully Deployed with Nginx Proxy!"
echo "=========================================================="
echo "Domain Access (HTTP & HTTPS via 136.108.118.191.sslip.io):"
echo " - Portal Dashboard:   https://136.108.118.191.sslip.io/"
echo " - Muster Web UI:      https://muster.136.108.118.191.sslip.io/   (or /muster/)"
echo " - Stamper GUI:        https://stamper.136.108.118.191.sslip.io/  (or /stamper/)"
echo " - AdminOps GUI:       https://ao.136.108.118.191.sslip.io/       (or /ao/)"
echo " - EvidenceOps GUI:    https://eo.136.108.118.191.sslip.io/       (or /eo/)"
echo " - Evidence Collector: https://ec.136.108.118.191.sslip.io/       (or /ec/)"
echo " - Tenant Simulator:   https://sim.136.108.118.191.sslip.io/      (or /stacksim/)"
echo " - Muster REST API:    https://api.136.108.118.191.sslip.io/      (or /muster-api/)"
echo "=========================================================="
