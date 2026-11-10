#!/bin/bash
set -e

# ── Create all data subdirectories the modules expect ───────────────────────
mkdir -p /app/data
mkdir -p /app/data/tenant          # CES_TENANT_ROOT used by walkthrough
mkdir -p /app/data/pipeline        # pipeline working files
mkdir -p /app/data/storage         # EO storage
mkdir -p /var/log/supervisor
mkdir -p /app/out/logs

# ── Clean up stale lock/pid files from previous runs ────────────────────────
find /app/ces/tenant-stacksim/.stacksim -name "*.lock" -delete 2>/dev/null || true
rm -f /var/run/supervisord.pid /var/run/supervisor.sock 2>/dev/null || true

# ── Initialize SQLite database directory (ces.db is auto-created by better-sqlite3) ──
# Just ensure the pipeline root has the right permissions
chmod -R 755 /app/data 2>/dev/null || true

# ── Initialize simulator scenario (idempotent) ──────────────────────────────
if [ ! -d "/app/ces/tenant-stacksim/.stacksim/tenants/s1-mach" ]; then
    echo "==> Initializing tenant-stacksim scenario s1-mach..."
    cd /app/ces/tenant-stacksim
    node bin/stacksim.mjs scenario s1-mach || true
    cd /app
fi

# ── Make scripts executable ──────────────────────────────────────────────────
chmod +x /app/docker/start-walkthrough.sh 2>/dev/null || true

# ── Validate required secrets are set ───────────────────────────────────────
if [ -z "${JWT_SECRET:-}" ] || [ "${JWT_SECRET}" = "change_me_min_32_chars" ]; then
    echo "ERROR: JWT_SECRET is not set or is still the placeholder value."
    echo "       Edit your .env file and set a real secret (openssl rand -hex 32)."
    exit 1
fi

# ── If user passed a custom command, run it instead ─────────────────────────
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

echo "==> Starting CES services under Supervisor..."
exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisord.conf
