#!/usr/bin/env bash
# Blue Heron CES — Docker Stack Launch Script for Linux / macOS / Cloud VMs
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "  Blue Heron CES -- Docker Deployment Launcher"
echo "=========================================================="

# Preflight check
if ! docker info >/dev/null 2>&1; then
    echo "ERROR: Docker daemon is not running. Please start Docker and re-run."
    exit 1
fi
echo "-> Docker daemon is healthy."

# Ensure .env exists
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
fi

echo ""
echo "[DOCKER] Building and starting all containers..."
docker compose up --build -d

echo ""
echo "=========================================================="
echo "  ALL CES SERVICES RUNNING IN DOCKER"
echo "=========================================================="
echo "  Muster Web Portal (HTTPS): https://127.0.0.1.sslip.io"
echo "  Muster Web Portal (HTTP):  http://localhost:5173"
echo "  Alternative HTTP Web:      http://localhost:8080"
echo "  Muster Backend API:        http://localhost:4000/auth/me"
echo "  Tenant Auth Daemon:        http://localhost:4690/status"
echo "  Mock GCC High Cloud:       http://localhost:4390"
echo "  PostgreSQL Database:       localhost:5434 (db: muster_db)"
echo "=========================================================="
echo "  Note: Open https://127.0.0.1.sslip.io in your browser"
echo "        (accept self-signed cert on first visit)"
echo "  To view logs:    docker compose logs -f"
echo "  To stop stack:   docker compose down"
echo "  With Stamper:    docker compose --profile full up -d"
echo ""
