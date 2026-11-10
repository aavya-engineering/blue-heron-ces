#!/usr/bin/env bash
# =============================================================================
# CES Manage Script — day-to-day operations
# Usage: ./manage.sh <command>
#
# Commands:
#   status        Show running containers and port bindings
#   logs [svc]    Tail logs  (svc: ces | nginx | db-ui | muster-api | eo | stamper | ao | ec | stacksim)
#   stop          Stop all containers
#   start         Start all containers
#   restart [svc] Restart one service or all (e.g. ./manage.sh restart ces)
#   update        Pull latest code and rebuild
#   shell         Open a bash shell inside the ces container
#   ps-svc        Show supervisor process status inside the container
#   health        Quick health check on every module port
#   backup        Dump ces.db and data to ./backups/<timestamp>/
#   restore <dir> Restore a backup (WARNING: overwrites current data)
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$REPO_DIR/deploy"
ENV_FILE="$DEPLOY_DIR/.env"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[CES]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
die()     { echo -e "${RED}[ERR]${NC}  $*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; } || warn ".env not found — some commands may not work"

cd "$REPO_DIR"

CMD="${1:-help}"

case "$CMD" in

  # ── Status ─────────────────────────────────────────────────────────────────
  status)
    echo ""
    info "Container status:"
    docker compose ps
    echo ""
    info "Port bindings:"
    docker compose ps --format "table {{.Service}}\t{{.Ports}}"
    ;;

  # ── Logs ───────────────────────────────────────────────────────────────────
  logs)
    SVC="${2:-}"
    if [[ -n "$SVC" ]]; then
      # Named docker service
      case "$SVC" in
        ces|nginx|db-ui) docker compose logs -f "$SVC" ;;
        # Supervisor-managed services inside the ces container
        muster-api|eo|ao|stamper|ec|stacksim|muster-ui)
          docker compose exec ces tail -f "/var/log/supervisor/${SVC}.out.log" ;;
        *) die "Unknown service '$SVC'. Try: ces nginx db-ui muster-api eo ao stamper ec stacksim" ;;
      esac
    else
      docker compose logs -f
    fi
    ;;

  # ── Stop / Start / Restart ─────────────────────────────────────────────────
  stop)
    info "Stopping all containers..."
    docker compose stop
    success "Stopped"
    ;;

  start)
    info "Starting all containers..."
    docker compose up -d
    success "Started — https://${SERVER_HOST:-localhost}"
    ;;

  restart)
    SVC="${2:-}"
    if [[ -n "$SVC" ]]; then
      info "Restarting $SVC ..."
      docker compose restart "$SVC"
    else
      info "Restarting all containers..."
      docker compose restart
    fi
    success "Done"
    ;;

  # ── Update ─────────────────────────────────────────────────────────────────
  update)
    info "Pulling latest code..."
    git restore ces/tenant-stacksim/psmodules 2>/dev/null || true
    git pull --ff-only
    info "Rebuilding image..."
    docker compose build --progress=plain
    info "Recreating containers..."
    docker compose up -d --force-recreate
    success "Update complete"
    ;;

  # ── Shell ──────────────────────────────────────────────────────────────────
  shell)
    info "Opening bash shell in ces container..."
    docker compose exec ces bash
    ;;

  # ── Supervisor process list ────────────────────────────────────────────────
  ps-svc)
    info "Supervisor processes inside ces container:"
    docker compose exec ces supervisorctl status
    ;;

  # ── Health check ───────────────────────────────────────────────────────────
  health)
    echo ""
    info "Health check on all module ports:"
    declare -A PORTS=(
      ["muster-api"]="4000"
      ["evidence-collector"]="4001"
      ["evidenceops"]="5004"
      ["stamper"]="5002"
      ["adminops"]="5003"
      ["muster-ui"]="5173"
      ["stacksim"]="4390"
    )
    ALL_OK=true
    for svc in "${!PORTS[@]}"; do
      port="${PORTS[$svc]}"
      status_code=$(docker compose exec -T ces sh -c "curl -s -o /dev/null -w '%{http_code}' http://localhost:$port/ --max-time 3" 2>/dev/null || echo "000")
      if [[ "$status_code" =~ ^(200|301|302|401|403|404)$ ]]; then
        echo -e "  ${GREEN}✓${NC} $svc ($port)"
      else
        echo -e "  ${RED}✗${NC} $svc ($port)"
        ALL_OK=false
      fi
    done
    echo ""
    $ALL_OK && success "All modules responding" || warn "Some modules not responding — check: ./manage.sh logs"
    ;;

  # ── Backup ─────────────────────────────────────────────────────────────────
  backup)
    TS="$(date +%Y%m%d-%H%M%S)"
    BACKUP_DIR="$REPO_DIR/backups/$TS"
    mkdir -p "$BACKUP_DIR"
    info "Backing up data volume to $BACKUP_DIR ..."
    docker compose exec -T ces sh -c "sqlite3 /app/data/ces.db '.backup /app/data/ces.db.bak'" 2>/dev/null || \
      docker compose exec -T ces cp /app/data/ces.db /app/data/ces.db.bak
    docker run --rm \
      -v ces_data:/data \
      -v "$BACKUP_DIR":/backup \
      alpine tar czf /backup/ces_data.tar.gz -C /data .
    docker run --rm \
      -v ces_out:/out \
      -v "$BACKUP_DIR":/backup \
      alpine tar czf /backup/ces_out.tar.gz -C /out .
    success "Backup saved to $BACKUP_DIR"
    echo "  ces_data.tar.gz  — pipeline + ces.db"
    echo "  ces_out.tar.gz   — run outputs"
    ;;

  # ── Restore ────────────────────────────────────────────────────────────────
  restore)
    BACKUP_DIR="${2:-}"
    [[ -z "$BACKUP_DIR" ]] && die "Usage: ./manage.sh restore <backup-dir>"
    [[ -d "$BACKUP_DIR" ]] || die "Backup directory not found: $BACKUP_DIR"
    warn "This will OVERWRITE current data. Press Ctrl+C to cancel, Enter to continue."
    read -r
    info "Stopping containers..."
    docker compose stop ces
    info "Restoring data volume from $BACKUP_DIR ..."
    docker run --rm \
      -v ces_data:/data \
      -v "$BACKUP_DIR":/backup \
      alpine sh -c "rm -rf /data/* && tar xzf /backup/ces_data.tar.gz -C /data"
    info "Restoring output volume..."
    docker run --rm \
      -v ces_out:/out \
      -v "$BACKUP_DIR":/backup \
      alpine sh -c "rm -rf /out/* && tar xzf /backup/ces_out.tar.gz -C /out"
    docker compose start ces
    success "Restore complete from $BACKUP_DIR"
    ;;

  # ── Help ───────────────────────────────────────────────────────────────────
  help|*)
    echo ""
    echo "  CES Manage Script"
    echo ""
    echo "  Usage: ./manage.sh <command>"
    echo ""
    echo "  Commands:"
    echo "    status              Show running containers"
    echo "    logs [svc]          Tail logs (svc: ces nginx muster-api eo ao stamper ec stacksim)"
    echo "    stop                Stop all containers"
    echo "    start               Start all containers"
    echo "    restart [svc]       Restart one service or all"
    echo "    update              Pull latest + rebuild"
    echo "    shell               Bash shell inside ces container"
    echo "    ps-svc              Supervisor process list inside container"
    echo "    health              Quick port health check"
    echo "    backup              Save data to ./backups/<timestamp>/"
    echo "    restore <dir>       Restore a backup (overwrites current data)"
    echo ""
    ;;
esac
