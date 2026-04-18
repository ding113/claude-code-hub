#!/usr/bin/env bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
  echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $*"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $*" >&2
}

usage() {
  cat <<'EOF'
Zero-downtime Docker rollout for server-side deployments.

Usage:
  server-zero-downtime-rollout.sh --image-tag <tag> [options]

Required:
  --image-tag <tag>            Image tag already available on the server

Optional:
  --deploy-dir <dir>           Deployment directory containing docker-compose.run.yml and .env
  --compose-file <file>        Compose file path
  --env-file <file>            Environment file path
  --nginx-config <file>        Nginx config file containing the target domain block
  --domain <name>              Domain served by the target Nginx block
  --health-path <path>         Health path, default: /api/actions/health
  --standard-port <port>       Standard local port, default: APP_PORT from .env or 23000
  --green-port <port>          Temporary green port for fallback path, default: standard+1
  --app-service <name>         Compose app service name, default: app
  --backup-root <dir>          Backup root, default: /opt/backups/claude-code-hub
  --current-tag <tag>          Runtime tag to retag for compose app, default: claude-code-hub-local:current
  --green-name <name>          Manual green container name for fallback path
  --keep-old-running           Keep old live container running after cutover (default)
  --stop-old-after-cutover     Stop old live container after successful cutover
  --local-timeout <sec>        Local health timeout, default: 90
  --public-timeout <sec>       Public health timeout, default: 45
  --dry-run                    Print the rollout plan without changing runtime state
  -h, --help                   Show this help

Behavior:
  1. Detect current live port from nginx and verify current public health
  2. Backup nginx / compose / env and current image tag
  3. Retag current image to the requested image tag
  4. Prefer compose on the standard port when it is free or can be reclaimed safely
  5. Otherwise, start a manual green container on a temporary port and cut nginx there
  6. Keep the old live container by default so rollback stays fast and low-risk
EOF
}

IMAGE_TAG=""
DEPLOY_DIR="/opt/apps/claude-code-hub-local"
COMPOSE_FILE=""
ENV_FILE=""
NGINX_CONFIG="/etc/nginx/sites-enabled/fkcodex-apps.conf"
DOMAIN="cch.fkcodex.com"
HEALTH_PATH="/api/actions/health"
STANDARD_PORT=""
GREEN_PORT=""
APP_SERVICE="app"
BACKUP_ROOT="/opt/backups/claude-code-hub"
CURRENT_TAG="claude-code-hub-local:current"
GREEN_NAME=""
KEEP_OLD_RUNNING=true
COMPOSE_OVERRIDE_FILE=""
LOCAL_HEALTH_TIMEOUT=90
PUBLIC_HEALTH_TIMEOUT=45
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-tag)
      IMAGE_TAG="${2:-}"
      shift 2
      ;;
    --deploy-dir)
      DEPLOY_DIR="${2:-}"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --nginx-config)
      NGINX_CONFIG="${2:-}"
      shift 2
      ;;
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --health-path)
      HEALTH_PATH="${2:-}"
      shift 2
      ;;
    --standard-port)
      STANDARD_PORT="${2:-}"
      shift 2
      ;;
    --green-port)
      GREEN_PORT="${2:-}"
      shift 2
      ;;
    --app-service)
      APP_SERVICE="${2:-}"
      shift 2
      ;;
    --backup-root)
      BACKUP_ROOT="${2:-}"
      shift 2
      ;;
    --current-tag)
      CURRENT_TAG="${2:-}"
      shift 2
      ;;
    --green-name)
      GREEN_NAME="${2:-}"
      shift 2
      ;;
    --keep-old-running)
      KEEP_OLD_RUNNING=true
      shift
      ;;
    --stop-old-after-cutover)
      KEEP_OLD_RUNNING=false
      shift
      ;;
    --local-timeout)
      LOCAL_HEALTH_TIMEOUT="${2:-}"
      shift 2
      ;;
    --public-timeout)
      PUBLIC_HEALTH_TIMEOUT="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$IMAGE_TAG" ]]; then
  log_error "--image-tag is required"
  usage
  exit 1
fi

if [[ -z "$COMPOSE_FILE" ]]; then
  COMPOSE_FILE="$DEPLOY_DIR/docker-compose.run.yml"
fi

if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$DEPLOY_DIR/.env"
fi

for cmd in docker curl python3 nginx ss; do
  command -v "$cmd" >/dev/null 2>&1 || {
    log_error "Required command not found: $cmd"
    exit 1
  }
done

docker compose version >/dev/null 2>&1 || {
  log_error "docker compose plugin is required"
  exit 1
}

for path in "$DEPLOY_DIR" "$COMPOSE_FILE" "$ENV_FILE" "$NGINX_CONFIG"; do
  [[ -e "$path" ]] || {
    log_error "Required path not found: $path"
    exit 1
  }
done

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

normalize_numeric_port() {
  local name="$1"
  local raw="$2"
  local trimmed="${raw//[[:space:]]/}"
  if [[ ! "$trimmed" =~ ^[0-9]+$ ]]; then
    printf 'Invalid %s: %q\n' "$name" "$raw" >&2
    exit 1
  fi
  if (( trimmed < 1 || trimmed > 65535 )); then
    printf 'Invalid %s: %q (must be 1-65535)\n' "$name" "$raw" >&2
    exit 1
  fi
  printf '%s\n' "$trimmed"
}

if [[ -z "$STANDARD_PORT" ]]; then
  STANDARD_PORT="${APP_PORT:-23000}"
fi
STANDARD_PORT="$(normalize_numeric_port "STANDARD_PORT" "$STANDARD_PORT")"

if [[ -z "$GREEN_PORT" ]]; then
  GREEN_PORT="$((STANDARD_PORT + 1))"
fi
GREEN_PORT="$(normalize_numeric_port "GREEN_PORT" "$GREEN_PORT")"

if [[ -z "$GREEN_NAME" ]]; then
  GREEN_NAME="${COMPOSE_PROJECT_NAME:-claude-code-hub-local}_rollout_green"
fi

if [[ ! "$HEALTH_PATH" =~ ^/[A-Za-z0-9/_.-]*$ ]]; then
  printf 'Invalid HEALTH_PATH: %q\n' "$HEALTH_PATH" >&2
  exit 1
fi

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-claude-code-hub-local}"
DOCKER_NETWORK="${PROJECT_NAME}_default"
BACKUP_TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/${BACKUP_TIMESTAMP}"
NGINX_BACKUP="${BACKUP_DIR}/$(basename "$NGINX_CONFIG")"
COMPOSE_OVERRIDE_FILE="${BACKUP_DIR}/docker-compose.rollout.override.yml"
CUTOVER_DONE=false
LOCK_DIR="/tmp/${PROJECT_NAME//[^a-zA-Z0-9_.-]/_}.${DOMAIN//[^a-zA-Z0-9_.-]/_}.rollout.lock"
ROLLBACK_ATTEMPTED=false

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    return 0
  fi
  log_error "Another rollout appears to be running: $LOCK_DIR"
  exit 1
}

release_lock() {
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}

get_domain_proxy_port() {
  python3 - "$NGINX_CONFIG" "$DOMAIN" <<'PY'
import sys
from pathlib import Path

config = Path(sys.argv[1]).read_text().splitlines(keepends=True)
domain = sys.argv[2]

def iter_server_blocks(lines):
    in_server = False
    depth = 0
    block = []
    for line in lines:
        stripped = line.strip()
        if not in_server and stripped.startswith("server") and "{" in stripped:
            in_server = True
            block = [line]
            depth = line.count("{") - line.count("}")
            if depth == 0:
                yield "".join(block)
                in_server = False
            continue
        if in_server:
            block.append(line)
            depth += line.count("{") - line.count("}")
            if depth == 0:
                yield "".join(block)
                in_server = False

for block in iter_server_blocks(config):
    if f"server_name {domain};" in block:
        for line in block.splitlines():
            if "proxy_pass http://127.0.0.1:" in line:
                value = line.split("proxy_pass http://127.0.0.1:", 1)[1].split(";", 1)[0].strip()
                print(value)
                sys.exit(0)

sys.exit(1)
PY
}

set_domain_proxy_port() {
  local new_port="$1"
  python3 - "$NGINX_CONFIG" "$DOMAIN" "$new_port" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
domain = sys.argv[2]
new_port = sys.argv[3]
lines = path.read_text().splitlines(keepends=True)

output = []
block = []
in_server = False
depth = 0
updated = False

def rewrite_block(block_text):
    global updated
    if f"server_name {domain};" not in block_text:
        return block_text
    if "proxy_pass http://127.0.0.1:" not in block_text:
        return block_text
    if updated:
        raise SystemExit("multiple matching server blocks found")
    rewritten_lines = []
    replaced = False
    for line in block_text.splitlines(keepends=True):
        if "proxy_pass http://127.0.0.1:" in line and not replaced:
            prefix = line.split("proxy_pass http://127.0.0.1:", 1)[0]
            suffix = "\n" if line.endswith("\n") else ""
            rewritten_lines.append(f"{prefix}proxy_pass http://127.0.0.1:{new_port};{suffix}")
            replaced = True
        else:
            rewritten_lines.append(line)
    if not replaced:
        raise SystemExit("failed to update target server block")
    updated = True
    return "".join(rewritten_lines)

for line in lines:
    stripped = line.strip()
    if not in_server and stripped.startswith("server") and "{" in stripped:
        in_server = True
        block = [line]
        depth = line.count("{") - line.count("}")
        if depth == 0:
            output.append(rewrite_block("".join(block)))
            in_server = False
        continue
    if in_server:
        block.append(line)
        depth += line.count("{") - line.count("}")
        if depth == 0:
            output.append(rewrite_block("".join(block)))
            in_server = False
        continue
    output.append(line)

if in_server:
    raise SystemExit("unterminated server block")
if not updated:
    raise SystemExit("target domain block not found")

path.write_text("".join(output))
PY
}

find_container_by_host_port() {
  local port="$1"
  docker ps --format '{{.Names}}\t{{.Ports}}' | awk -v port="$port" '
    $0 ~ ("(^|[,[:space:]])([^,[:space:]]+:)?" port "->") {print $1; exit}
  '
}

get_container_label() {
  local container_name="$1"
  local label_name="$2"
  docker inspect --format "{{ index .Config.Labels \"$label_name\" }}" "$container_name" 2>/dev/null || true
}

is_live_container_same_compose_service() {
  local container_name="$1"
  [[ -n "$container_name" ]] || return 1

  local live_project live_service
  live_project="$(get_container_label "$container_name" "com.docker.compose.project")"
  live_service="$(get_container_label "$container_name" "com.docker.compose.service")"

  [[ -n "$live_project" && -n "$live_service" && "$live_project" == "$PROJECT_NAME" && "$live_service" == "$APP_SERVICE" ]]
}

port_is_free() {
  local port="$1"
  ! ss -ltnH "( sport = :${port} )" | grep -q .
}

wait_http_ok() {
  local url="$1"
  local timeout="${2:-90}"
  local start
  start="$(date +%s)"
  while true; do
    local body=""
    if body="$(curl -fsS "$url" 2>/dev/null)" && printf '%s' "$body" | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if payload.get("status") == "healthy" else 1)
' >/dev/null 2>&1; then
      return 0
    fi
    if (( "$(date +%s)" - start >= timeout )); then
      return 1
    fi
    sleep 1
  done
}

backup_runtime() {
  if [[ "$DRY_RUN" == true ]]; then
    log_info "[dry-run] Would create runtime backup: $BACKUP_DIR"
    return 0
  fi
  install -d -m 700 "$BACKUP_DIR"
  cp "$NGINX_CONFIG" "$NGINX_BACKUP"
  cp "$COMPOSE_FILE" "$BACKUP_DIR/"
  install -m 600 "$ENV_FILE" "$BACKUP_DIR/$(basename "$ENV_FILE")"
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' >"$BACKUP_DIR/docker-ps.txt"
  docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}' >"$BACKUP_DIR/docker-images.txt"
  printf '%s\n' "$IMAGE_TAG" >"$BACKUP_DIR/requested-image-tag.txt"
  printf '%s\n' "$CURRENT_TAG" >"$BACKUP_DIR/current-runtime-tag.txt"
  if docker image inspect "$CURRENT_TAG" >/dev/null 2>&1; then
    docker tag "$CURRENT_TAG" "${CURRENT_TAG%:*}:rollback-${BACKUP_TIMESTAMP}"
  fi
}

restore_proxy_backup() {
  if [[ ! -f "$NGINX_BACKUP" ]]; then
    log_error "Nginx backup not found: $NGINX_BACKUP"
    exit 1
  fi
  cp "$NGINX_BACKUP" "$NGINX_CONFIG"
  if ! nginx -t >/dev/null 2>&1; then
    log_error "Failed to restore nginx backup cleanly: $NGINX_BACKUP"
    exit 1
  fi
  nginx -s reload >/dev/null
}

cutover_proxy() {
  local target_port="$1"
  if [[ "$DRY_RUN" == true ]]; then
    log_info "[dry-run] Would switch nginx traffic to 127.0.0.1:${target_port}"
    return 0
  fi
  set_domain_proxy_port "$target_port"
  if ! nginx -t >/dev/null 2>&1; then
    cp "$NGINX_BACKUP" "$NGINX_CONFIG"
    log_error "nginx -t failed after editing config, restored backup"
    exit 1
  fi
  if ! nginx -s reload >/dev/null; then
    cp "$NGINX_BACKUP" "$NGINX_CONFIG"
    nginx -t >/dev/null 2>&1 && nginx -s reload >/dev/null 2>&1 || true
    log_error "nginx reload failed after editing config, restored backup"
    exit 1
  fi
  CUTOVER_DONE=true
}

stop_old_live_container() {
  local name="$1"
  if [[ -n "$name" && "$KEEP_OLD_RUNNING" == false ]]; then
    if [[ "$DRY_RUN" == true ]]; then
      log_info "[dry-run] Would stop previous live container: $name"
      return 0
    fi
    docker stop "$name" >/dev/null || true
    log_info "Stopped previous live container: $name"
  elif [[ -n "$name" ]]; then
    log_info "Keeping previous live container for rollback: $name"
  fi
}

stop_non_live_standard_holder() {
  local name="$1"
  if [[ -z "$name" ]]; then
    return 0
  fi
  if [[ "$DRY_RUN" == true ]]; then
    log_info "[dry-run] Would stop non-live container occupying standard port: $name"
    return 0
  fi
  docker stop "$name" >/dev/null
  log_info "Stopped non-live container occupying standard port: $name"
}

start_compose_on_standard_port() {
  log_info "Starting compose app service on standard port ${STANDARD_PORT}"
  if [[ "$DRY_RUN" == true ]]; then
    log_info "[dry-run] Would start compose app ${APP_SERVICE} on standard port ${STANDARD_PORT} using ${CURRENT_TAG}"
    return 0
  fi
  cat >"$COMPOSE_OVERRIDE_FILE" <<EOF
services:
  ${APP_SERVICE}:
    image: ${CURRENT_TAG}
    environment:
      HOST: 0.0.0.0
      HOSTNAME: 0.0.0.0
EOF
  (
    cd "$DEPLOY_DIR"
    AUTO_MIGRATE=false APP_PORT="$STANDARD_PORT" docker compose -f "$COMPOSE_FILE" -f "$COMPOSE_OVERRIDE_FILE" up -d --no-deps "$APP_SERVICE"
  ) >/dev/null
}

start_manual_green() {
  local candidate_port="$1"
  local dsn="postgresql://${DB_USER:-postgres}:${DB_PASSWORD:-postgres}@postgres:5432/${DB_NAME:-claude_code_hub}"
  local redis_url="redis://redis:6379"

  log_info "Starting manual green container ${GREEN_NAME} on port ${candidate_port}"
  if [[ "$DRY_RUN" == true ]]; then
    log_info "[dry-run] Would start manual green container ${GREEN_NAME} on ${candidate_port}"
    return 0
  fi
  if [[ "${LIVE_CONTAINER:-}" == "$GREEN_NAME" ]]; then
    log_error "Refusing to remove current live green container: $GREEN_NAME"
    exit 1
  fi
  docker rm -f "$GREEN_NAME" >/dev/null 2>&1 || true
  docker run -d \
    --name "$GREEN_NAME" \
    --restart unless-stopped \
    --network "$DOCKER_NETWORK" \
    --env-file "$ENV_FILE" \
    -e HOST=0.0.0.0 \
    -e HOSTNAME=0.0.0.0 \
    -e NODE_ENV=production \
    -e DSN="$dsn" \
    -e REDIS_URL="$redis_url" \
    -e AUTO_MIGRATE=false \
    -e APP_PORT="$candidate_port" \
    -e HEALTH_PATH="$HEALTH_PATH" \
    -p "127.0.0.1:${candidate_port}:3000" \
    --health-cmd "node -e \"fetch('http://127.0.0.1:3000' + process.env.HEALTH_PATH).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"" \
    --health-interval 30s \
    --health-timeout 5s \
    --health-retries 3 \
    --health-start-period 30s \
    "$IMAGE_TAG" >/dev/null
}

verify_public_health() {
  local url="https://${DOMAIN}${HEALTH_PATH}"
  wait_http_ok "$url" "$PUBLIC_HEALTH_TIMEOUT" || {
    log_error "Public health check failed: $url"
    if [[ "$CUTOVER_DONE" == true && "$DRY_RUN" == false ]]; then
      log_warn "Rolling nginx back to previous live port"
      restore_proxy_backup
      ROLLBACK_ATTEMPTED=true
    fi
    exit 1
  }
}

verify_live_public_before_rollout() {
  local url="https://${DOMAIN}${HEALTH_PATH}"
  wait_http_ok "$url" "$PUBLIC_HEALTH_TIMEOUT" || {
    log_error "Current public health is not healthy, aborting rollout: $url"
    exit 1
  }
}

print_plan_and_exit() {
  local mode="$1"
  echo
  log_info "Dry run only. No changes were made."
  echo "  requested image:  $IMAGE_TAG"
  echo "  current live:     ${LIVE_CONTAINER:-<none>} on ${LIVE_PORT}"
  echo "  standard port:    $STANDARD_PORT"
  echo "  standard holder:  ${STANDARD_PORT_CONTAINER:-<none>}"
  echo "  selected mode:    $mode"
  echo "  keep old live:    $KEEP_OLD_RUNNING"
  echo "  backup dir:       $BACKUP_DIR"
  exit 0
}

handle_exit() {
  local status="$1"
  release_lock
  if [[ "$status" -ne 0 && "$CUTOVER_DONE" == true && "$DRY_RUN" == false && "$ROLLBACK_ATTEMPTED" == false && -f "$NGINX_BACKUP" ]]; then
    log_warn "Failure detected after cutover, restoring nginx backup"
    cp "$NGINX_BACKUP" "$NGINX_CONFIG" >/dev/null 2>&1 || true
    nginx -t >/dev/null 2>&1 && nginx -s reload >/dev/null 2>&1 || true
  fi
}

acquire_lock
trap 'handle_exit $?' EXIT

LIVE_PORT="$(get_domain_proxy_port)"
LIVE_CONTAINER="$(find_container_by_host_port "$LIVE_PORT" || true)"
STANDARD_PORT_CONTAINER="$(find_container_by_host_port "$STANDARD_PORT" || true)"
LIVE_IS_CURRENT_COMPOSE_SERVICE=false
if is_live_container_same_compose_service "$LIVE_CONTAINER"; then
  LIVE_IS_CURRENT_COMPOSE_SERVICE=true
fi

log_info "Current live domain: ${DOMAIN}"
log_info "Current live port: ${LIVE_PORT}"
log_info "Current live container: ${LIVE_CONTAINER:-<none>}"
log_info "Standard port: ${STANDARD_PORT}"
log_info "Green fallback port: ${GREEN_PORT}"
log_info "Keep old live container after cutover: ${KEEP_OLD_RUNNING}"
if [[ "$LIVE_IS_CURRENT_COMPOSE_SERVICE" == true ]]; then
  log_warn "Live container belongs to the current compose app service; rollout will avoid compose recreate and use manual green"
fi

docker image inspect "$IMAGE_TAG" >/dev/null 2>&1 || {
  log_error "Image tag not found on server: $IMAGE_TAG"
  exit 1
}

verify_live_public_before_rollout

if [[ "$DRY_RUN" == true ]]; then
  if [[ "$LIVE_IS_CURRENT_COMPOSE_SERVICE" == true ]]; then
    print_plan_and_exit "manual-green-compose-live"
  elif [[ "$LIVE_PORT" != "$STANDARD_PORT" ]] && port_is_free "$STANDARD_PORT"; then
    print_plan_and_exit "compose-standard-free"
  elif [[ "$LIVE_PORT" != "$STANDARD_PORT" ]] && [[ -n "$STANDARD_PORT_CONTAINER" && "$STANDARD_PORT_CONTAINER" != "$LIVE_CONTAINER" ]]; then
    print_plan_and_exit "compose-standard-reclaim"
  elif [[ "$LIVE_PORT" != "$STANDARD_PORT" ]] && wait_http_ok "http://127.0.0.1:${STANDARD_PORT}${HEALTH_PATH}" 2; then
    print_plan_and_exit "cut-back-to-running-standard"
  else
    print_plan_and_exit "manual-green"
  fi
fi

backup_runtime
log_success "Runtime backup created: $BACKUP_DIR"

docker tag "$IMAGE_TAG" "$CURRENT_TAG"
log_info "Retagged ${IMAGE_TAG} -> ${CURRENT_TAG}"

if [[ "$LIVE_IS_CURRENT_COMPOSE_SERVICE" == false && "$LIVE_PORT" != "$STANDARD_PORT" ]] && port_is_free "$STANDARD_PORT"; then
  start_compose_on_standard_port
  wait_http_ok "http://127.0.0.1:${STANDARD_PORT}${HEALTH_PATH}" "$LOCAL_HEALTH_TIMEOUT" || {
    log_error "Compose app failed local health check on standard port ${STANDARD_PORT}"
    exit 1
  }
  cutover_proxy "$STANDARD_PORT"
  verify_public_health
  stop_old_live_container "$LIVE_CONTAINER"
  log_success "Traffic switched to compose app on standard port ${STANDARD_PORT}"
  log_info "Runtime ownership: compose-managed"
elif [[ "$LIVE_IS_CURRENT_COMPOSE_SERVICE" == false && "$LIVE_PORT" != "$STANDARD_PORT" ]] && [[ -n "$STANDARD_PORT_CONTAINER" && "$STANDARD_PORT_CONTAINER" != "$LIVE_CONTAINER" ]]; then
  log_info "Standard port ${STANDARD_PORT} is occupied by non-live container ${STANDARD_PORT_CONTAINER}, reclaiming it"
  stop_non_live_standard_holder "$STANDARD_PORT_CONTAINER"
  port_is_free "$STANDARD_PORT" || {
    log_error "Standard port is still in use after reclaim attempt: ${STANDARD_PORT}"
    exit 1
  }
  start_compose_on_standard_port
  wait_http_ok "http://127.0.0.1:${STANDARD_PORT}${HEALTH_PATH}" "$LOCAL_HEALTH_TIMEOUT" || {
    log_error "Compose app failed local health check on reclaimed standard port ${STANDARD_PORT}"
    exit 1
  }
  cutover_proxy "$STANDARD_PORT"
  verify_public_health
  stop_old_live_container "$LIVE_CONTAINER"
  log_success "Traffic switched to compose app on reclaimed standard port ${STANDARD_PORT}"
  log_info "Runtime ownership: compose-managed"
elif [[ "$LIVE_IS_CURRENT_COMPOSE_SERVICE" == false && "$LIVE_PORT" != "$STANDARD_PORT" ]] && wait_http_ok "http://127.0.0.1:${STANDARD_PORT}${HEALTH_PATH}" 2; then
  log_info "Standard port ${STANDARD_PORT} is already healthy, cutting traffic back without restarting app"
  cutover_proxy "$STANDARD_PORT"
  verify_public_health
  stop_old_live_container "$LIVE_CONTAINER"
  log_success "Traffic switched to already-running app on standard port ${STANDARD_PORT}"
  log_info "Runtime ownership: compose-managed"
else
  if [[ "$GREEN_PORT" == "$LIVE_PORT" || "$GREEN_PORT" == "$STANDARD_PORT" ]]; then
    GREEN_PORT="$((STANDARD_PORT + 2))"
  fi
  port_is_free "$GREEN_PORT" || {
    log_error "Green port is already in use: $GREEN_PORT"
    exit 1
  }
  start_manual_green "$GREEN_PORT"
  wait_http_ok "http://127.0.0.1:${GREEN_PORT}${HEALTH_PATH}" "$LOCAL_HEALTH_TIMEOUT" || {
    log_error "Manual green container failed local health check on ${GREEN_PORT}"
    exit 1
  }
  cutover_proxy "$GREEN_PORT"
  verify_public_health
  stop_old_live_container "$LIVE_CONTAINER"
  if [[ "$LIVE_PORT" == "$STANDARD_PORT" ]]; then
    log_warn "Traffic is healthy on temporary green port ${GREEN_PORT}, but standard port normalization is still pending"
  else
    log_warn "Standard port ${STANDARD_PORT} was unavailable, kept traffic on temporary green port ${GREEN_PORT}"
  fi
  log_info "Runtime ownership: manual green container"
fi

FINAL_PORT="$(get_domain_proxy_port)"
FINAL_CONTAINER="$(find_container_by_host_port "$FINAL_PORT" || true)"

echo
log_success "Rollout complete"
echo "  image tag:        $IMAGE_TAG"
echo "  current tag:      $CURRENT_TAG"
echo "  live port:        $FINAL_PORT"
echo "  live container:   ${FINAL_CONTAINER:-<none>}"
echo "  nginx backup:     $NGINX_BACKUP"
echo "  runtime backup:   $BACKUP_DIR"
