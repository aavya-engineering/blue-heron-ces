#!/usr/bin/env bash
# =============================================================================
# CES Deploy Script — Ubuntu 22.04 / 24.04
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh           # first-time full deploy
#   ./deploy.sh --update  # pull latest code and restart containers
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$REPO_DIR/deploy"
ENV_FILE="$DEPLOY_DIR/.env"

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[CES]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
die()     { echo -e "${RED}[ERR]${NC}  $*" >&2; exit 1; }

# ── Args ─────────────────────────────────────────────────────────────────────
UPDATE_ONLY=false
for arg in "$@"; do [[ "$arg" == "--update" ]] && UPDATE_ONLY=true; done

# =============================================================================
# 1. Load .env
# =============================================================================
if [[ ! -f "$ENV_FILE" ]]; then
  die ".env not found. Run:  cp $DEPLOY_DIR/.env.example $DEPLOY_DIR/.env  then fill it in."
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${SERVER_HOST:?SERVER_HOST must be set in .env}"
: "${JWT_SECRET:?JWT_SECRET must be set in .env}"
: "${SSL_MODE:=self-signed}"

# =============================================================================
# 2. Install dependencies (Docker, Docker Compose, openssl)
# =============================================================================
install_deps() {
  info "Checking system dependencies..."

  if ! command -v docker &>/dev/null; then
    info "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
    warn "Added $USER to the docker group. Log out and back in if you see permission errors."
  fi
  success "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

  if ! docker compose version &>/dev/null; then
    info "Installing Docker Compose plugin..."
    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends docker-compose-plugin
  fi
  success "Docker Compose $(docker compose version --short)"

  if ! command -v openssl &>/dev/null; then
    sudo apt-get install -y --no-install-recommends openssl
  fi
  success "openssl ready"

  if ! command -v git &>/dev/null; then
    sudo apt-get install -y --no-install-recommends git
  fi
  success "git ready"
}

# =============================================================================
# 3. SSL certificates
# =============================================================================
setup_ssl() {
  local CERT_DIR="$REPO_DIR/nginx/certs"
  mkdir -p "$CERT_DIR"

  case "$SSL_MODE" in
    self-signed)
      if [[ -f "$CERT_DIR/cert.pem" && -f "$CERT_DIR/key.pem" ]]; then
        warn "Self-signed cert already exists — skipping generation (delete cert.pem/key.pem to regenerate)"
        return
      fi
      info "Generating self-signed certificate for $SERVER_HOST ..."
      local SAN="DNS:$SERVER_HOST"
      if [[ "$SERVER_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        SAN="DNS:$SERVER_HOST,IP:$SERVER_HOST"
      elif [[ "$SERVER_HOST" =~ ([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+) ]]; then
        SAN="DNS:$SERVER_HOST,IP:${BASH_REMATCH[1]}"
      fi
      openssl req -x509 -nodes -days 365 \
        -newkey rsa:2048 \
        -keyout "$CERT_DIR/key.pem" \
        -out    "$CERT_DIR/cert.pem" \
        -subj   "/CN=$SERVER_HOST/O=CES/C=US" \
        -addext "subjectAltName=$SAN" 2>/dev/null
      success "Self-signed cert written to $CERT_DIR"
      ;;

    letsencrypt)
      : "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL must be set in .env for letsencrypt mode}"
      info "Requesting Let's Encrypt certificate for $SERVER_HOST ..."
      # Temporarily start nginx on port 80 for the ACME challenge
      docker compose -f "$REPO_DIR/docker-compose.yml" up -d nginx 2>/dev/null || true
      docker run --rm \
        -v certbot_conf:/etc/letsencrypt \
        -v certbot_www:/var/www/certbot \
        certbot/certbot certonly --webroot \
          -w /var/www/certbot \
          -d "$SERVER_HOST" \
          --email "$LETSENCRYPT_EMAIL" \
          --agree-tos --non-interactive
      # Copy Let's Encrypt certs to the nginx/certs folder nginx reads
      docker run --rm \
        -v certbot_conf:/etc/letsencrypt \
        -v "$CERT_DIR":/out \
        alpine sh -c "cp /etc/letsencrypt/live/$SERVER_HOST/fullchain.pem /out/cert.pem && cp /etc/letsencrypt/live/$SERVER_HOST/privkey.pem /out/key.pem"
      success "Let's Encrypt cert written to $CERT_DIR"
      ;;

    existing)
      [[ -f "$CERT_DIR/cert.pem" ]] || die "SSL_MODE=existing but $CERT_DIR/cert.pem not found"
      [[ -f "$CERT_DIR/key.pem"  ]] || die "SSL_MODE=existing but $CERT_DIR/key.pem not found"
      success "Using existing certs in $CERT_DIR"
      ;;

    *)
      die "Unknown SSL_MODE='$SSL_MODE'. Choose: self-signed | letsencrypt | existing"
      ;;
  esac
}

# =============================================================================
# 4. Patch nginx default.conf with the real SERVER_HOST
# =============================================================================
patch_nginx() {
  local CONF="$REPO_DIR/nginx/conf.d/default.conf"
  info "Patching nginx server_name → $SERVER_HOST ..."
  # Replace whatever is after "server_name" on that line
  sed -i "s|server_name .*;|server_name $SERVER_HOST _;|" "$CONF"
  success "nginx conf updated"
}

# =============================================================================
# 5. Write docker-compose override with secrets from .env
# =============================================================================
write_compose_override() {
  info "Writing docker-compose.override.yml with secrets..."
  cat > "$REPO_DIR/docker-compose.override.yml" <<OVERRIDE
# Auto-generated by deploy.sh — do not edit by hand
services:
  ces:
    environment:
      - JWT_SECRET=${JWT_SECRET}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - CES_EO_OPERATOR_SECRET=${CES_EO_OPERATOR_SECRET:-}
      - TENANT_SLUG=${TENANT_SLUG:-s1-mach}
OVERRIDE
  success "docker-compose.override.yml written"
}

# =============================================================================
# 6. Build and start
# =============================================================================
start_stack() {
  cd "$REPO_DIR"
  info "Building Docker image (this takes a few minutes on first run)..."
  docker compose build --progress=plain

  info "Starting containers..."
  docker compose up -d

  info "Waiting for ces-app to be healthy..."
  local tries=0
  until docker compose exec -T ces node -e "require('http').get('http://localhost:4000/',r=>process.exit(r.statusCode?0:1))" 2>/dev/null; do
    tries=$((tries+1))
    [[ $tries -gt 30 ]] && { warn "Health check timed out — check logs: ./manage.sh logs ces"; break; }
    sleep 5
  done
  success "Stack is up"
}

# =============================================================================
# 7. Update (pull + restart)
# =============================================================================
do_update() {
  cd "$REPO_DIR"
  info "Pulling latest code..."
  git restore ces/tenant-stacksim/psmodules 2>/dev/null || true
  git pull --ff-only

  info "Rebuilding and restarting..."
  docker compose build --progress=plain
  docker compose up -d --force-recreate
  success "Update complete"
}

# =============================================================================
# Main
# =============================================================================
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   CES — CMMC Compliance Engine Deploy    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

if $UPDATE_ONLY; then
  do_update
else
  install_deps
  setup_ssl
  patch_nginx
  write_compose_override
  start_stack
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deploy complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo "  App URL   : https://$SERVER_HOST"
echo "  Muster    : https://$SERVER_HOST/muster/"
echo "  Stamper   : https://$SERVER_HOST/stamper/"
echo "  AdminOps  : https://$SERVER_HOST/ao/"
echo "  EvidenceOps: https://$SERVER_HOST/eo/"
echo "  DB Web UI : http://$SERVER_HOST:8080 (or /db/)"
echo ""
echo "  Manage    : ./manage.sh  [status|logs|stop|restart|update|shell]"
echo ""
