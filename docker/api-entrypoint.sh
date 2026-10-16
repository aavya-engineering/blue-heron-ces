#!/bin/sh
set -e

echo "=== [muster-api] Container Starting ==="

# Wait for PostgreSQL TCP port to be open
echo "Waiting for PostgreSQL database to be reachable..."
MAX_RETRIES=30
RETRY_COUNT=0

until node -e "
const net = require('net');
let dbHost = 'postgres';
let dbPort = 5432;

if (process.env.DATABASE_URL) {
  try {
    const raw = process.env.DATABASE_URL.replace(/^postgresql:\/\//, 'http://');
    const u = new URL(raw);
    dbHost = u.hostname || 'postgres';
    dbPort = parseInt(u.port || '5432', 10);
  } catch (e) {}
}

const socket = net.createConnection({ host: dbHost, port: dbPort }, () => {
  socket.end();
  process.exit(0);
});
socket.setTimeout(2000);
socket.on('timeout', () => { socket.destroy(); process.exit(1); });
socket.on('error', () => process.exit(1));
" 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT+1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "ERROR: PostgreSQL is not reachable after $MAX_RETRIES attempts. Exiting."
    exit 1
  fi
  echo "PostgreSQL not reachable yet (attempt $RETRY_COUNT/$MAX_RETRIES)... waiting 2s"
  sleep 2
done

echo "-> PostgreSQL port is open. Running Prisma migrations..."

# Run database migrations with retry in case postgres is still initializing catalog
MIGRATE_RETRIES=10
MIGRATE_COUNT=0
until npx prisma migrate deploy; do
  MIGRATE_COUNT=$((MIGRATE_COUNT+1))
  if [ $MIGRATE_COUNT -ge $MIGRATE_RETRIES ]; then
    echo "ERROR: prisma migrate deploy failed after $MIGRATE_RETRIES attempts."
    exit 1
  fi
  echo "Prisma migrate waiting for database initialization (attempt $MIGRATE_COUNT/$MIGRATE_RETRIES)..."
  sleep 3
done

echo "-> Database schema is up to date."

# Start the application server
echo "Starting muster-api on port ${PORT:-4000}..."
exec node dist/server.js
