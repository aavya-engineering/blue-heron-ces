#!/bin/bash
# Waits for all CES modules to be ready, seeds the muster operator,
# writes a runtime config.local.json, then starts the Demo Commander server.
set -e

WALKTHROUGH_DIR="/app/handoff/walkthrough"
CONFIG_TEMPLATE="$WALKTHROUGH_DIR/config.docker.json"
# Write config to /app/data so it survives and is not in the read-only source tree
CONFIG_LOCAL="/app/data/walkthrough-config.local.json"

echo "[demo] waiting for modules to be ready..."
wait_for() {
  local url="$1" label="$2" tries=0
  until curl -s -o /dev/null -w "%{http_code}" "$url" --max-time 3 2>/dev/null \
        | grep -qE '^(200|301|302|401|403|404)$'; do
    tries=$((tries + 1))
    if [ $tries -gt 90 ]; then
      echo "[demo] WARNING: $label did not respond after 90 tries — continuing"
      return
    fi
    sleep 2
  done
  echo "[demo] $label ready"
}

wait_for "http://127.0.0.1:4390" "stacksim"
wait_for "http://127.0.0.1:4000" "muster-api"
wait_for "http://127.0.0.1:5002" "stamper"
wait_for "http://127.0.0.1:5003" "adminops"
wait_for "http://127.0.0.1:5004" "evidenceops"
wait_for "http://127.0.0.1:4001" "evidence-collector"

# ── Seed the muster operator (safe to run on every restart) ─────────────────
echo "[demo] seeding muster operator..."
cd /app/ces/ces-muster/muster-api
npx tsx scripts/seed.ts \
  --email  "demo@ces-demo.local" \
  --password "CesDemo2026!" 2>/dev/null || true
cd /app

# ── Resolve EO operator secret ───────────────────────────────────────────────
# Use the value from .env (CES_EO_OPERATOR_SECRET) or generate a random one.
# A generated secret is written to /app/data so it stays stable across restarts.
SECRET_FILE="/app/data/.eo-operator-secret"
if [ -n "${CES_EO_OPERATOR_SECRET:-}" ]; then
  EO_SECRET="$CES_EO_OPERATOR_SECRET"
elif [ -f "$SECRET_FILE" ]; then
  EO_SECRET="$(cat "$SECRET_FILE")"
else
  EO_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  echo "$EO_SECRET" > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  echo "[demo] generated and saved EO operator secret"
fi

# ── Write runtime config.local.json ─────────────────────────────────────────
# Use env vars (not CLI args) so node --input-type=module has no extra positional
# args that it would misinterpret as the script path.
CES_EO_SECRET="$EO_SECRET" CES_CFG_IN="$CONFIG_TEMPLATE" CES_CFG_OUT="$CONFIG_LOCAL" \
  node --input-type=module <<'SCRIPT'
import fs from 'fs';
const { CES_EO_SECRET: eoSecret, CES_CFG_IN: templatePath, CES_CFG_OUT: outPath } = process.env;
const cfg = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
if (!cfg.tokens) cfg.tokens = {};
cfg.tokens.eoOperator = eoSecret;
fs.writeFileSync(outPath, JSON.stringify(cfg, null, 2));
console.log('[demo] config.local.json written to', outPath);
SCRIPT

echo "[demo] starting Demo Commander server on port 4600..."
exec node "$WALKTHROUGH_DIR/server.mjs" --config "$CONFIG_LOCAL" --host 0.0.0.0
