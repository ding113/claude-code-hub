#!/usr/bin/env bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script version
VERSION="1.1.0"

# Global variables
SUFFIX=""
ADMIN_TOKEN=""
DB_PASSWORD=""
DEPLOY_DIR=""
OS_TYPE=""
IMAGE_TAG="latest"
BRANCH_NAME="main"
APP_PORT="23000"
APP_URL=""
NON_INTERACTIVE=false
DOMAIN=""
CADDY_EMAIL=""
CUSTOM_SSL_CERT=""
CUSTOM_SSL_KEY=""
NO_HTTPS_REDIRECT=false

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║                                                                ║"
    echo "║           Claude Code Hub - One-Click Deployment              ║"
    echo "║                      Version ${VERSION}                            ║"
    echo "║                                                                ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    cat << EOF
Claude Code Hub - One-Click Deployment Script v${VERSION}

Usage: $0 [OPTIONS]

OPTIONS:
  -t, --admin-token TOKEN    Set admin token (default: auto-generated)
  -p, --port PORT            Set application port (default: 23000)
  -b, --branch BRANCH        Set branch to deploy: main or dev (default: main)
      --db-password PASSWORD Set database password (default: auto-generated)
  -u, --app-url URL          Set application URL (e.g., https://api.example.com)
  -d, --deploy-dir DIR       Set deployment directory (default: OS-specific)
  -y, --non-interactive      Skip all interactive prompts
  -D, --domain DOMAIN        Enable Caddy reverse proxy with auto HTTPS
      --email EMAIL          Email for Let's Encrypt certificate notifications
      --ssl-cert PATH        Path to custom SSL certificate (optional)
      --ssl-key PATH         Path to custom SSL key (optional)
      --no-https-redirect    Allow HTTP access (disable HTTPS redirect)
  -h, --help                 Show this help message
  -v, --version              Show version information

ENVIRONMENT VARIABLES:
  You can also set configuration via environment variables (CLI args take precedence):
  CCH_ADMIN_TOKEN, CCH_PORT, CCH_BRANCH, CCH_DB_PASSWORD, CCH_APP_URL,
  CCH_DEPLOY_DIR, CCH_DOMAIN, CCH_EMAIL

EXAMPLES:
  # Interactive mode (default)
  $0

  # Non-interactive with auto-generated credentials
  $0 --branch main -y

  # Full CI/CD deployment
  $0 --admin-token "my-token" --port 8080 --branch main -y

  # Production with Caddy HTTPS
  $0 --domain api.example.com --email admin@example.com --branch main -y

SECURITY NOTE:
  Avoid passing sensitive values (admin-token, db-password) via CLI args as they
  may be visible in process listings. Use environment variables instead:
    export CCH_ADMIN_TOKEN="my-secure-token"
    $0 --non-interactive

For more information, visit: https://github.com/ding113/claude-code-hub
EOF
}

parse_args() {
    # First, load from environment variables
    ADMIN_TOKEN="${CCH_ADMIN_TOKEN:-$ADMIN_TOKEN}"
    APP_PORT="${CCH_PORT:-$APP_PORT}"
    BRANCH_NAME="${CCH_BRANCH:-$BRANCH_NAME}"
    DB_PASSWORD="${CCH_DB_PASSWORD:-$DB_PASSWORD}"
    APP_URL="${CCH_APP_URL:-$APP_URL}"
    DEPLOY_DIR="${CCH_DEPLOY_DIR:-$DEPLOY_DIR}"
    DOMAIN="${CCH_DOMAIN:-$DOMAIN}"
    CADDY_EMAIL="${CCH_EMAIL:-$CADDY_EMAIL}"

    # Parse CLI arguments (override environment variables)
    while [[ $# -gt 0 ]]; do
        case $1 in
            -t|--admin-token)
                ADMIN_TOKEN="$2"
                shift 2
                ;;
            -p|--port)
                APP_PORT="$2"
                shift 2
                ;;
            -b|--branch)
                BRANCH_NAME="$2"
                shift 2
                ;;
            --db-password)
                DB_PASSWORD="$2"
                shift 2
                ;;
            -u|--app-url)
                APP_URL="$2"
                shift 2
                ;;
            -d|--deploy-dir)
                DEPLOY_DIR="$2"
                shift 2
                ;;
            -y|--non-interactive)
                NON_INTERACTIVE=true
                shift
                ;;
            -D|--domain)
                DOMAIN="$2"
                shift 2
                ;;
            --email)
                CADDY_EMAIL="$2"
                shift 2
                ;;
            --ssl-cert)
                CUSTOM_SSL_CERT="$2"
                shift 2
                ;;
            --ssl-key)
                CUSTOM_SSL_KEY="$2"
                shift 2
                ;;
            --no-https-redirect)
                NO_HTTPS_REDIRECT=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            -v|--version)
                echo "Claude Code Hub Deploy Script v${VERSION}"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done

    # Validate branch name
    if [[ -n "$BRANCH_NAME" ]]; then
        case "$BRANCH_NAME" in
            main)
                IMAGE_TAG="latest"
                ;;
            dev)
                IMAGE_TAG="dev"
                ;;
            *)
                log_error "Invalid branch: $BRANCH_NAME. Must be 'main' or 'dev'"
                exit 1
                ;;
        esac
    fi

    # Validate custom SSL configuration
    if [[ -n "$CUSTOM_SSL_CERT" ]] && [[ -z "$CUSTOM_SSL_KEY" ]]; then
        log_error "--ssl-cert requires --ssl-key"
        exit 1
    fi
    if [[ -n "$CUSTOM_SSL_KEY" ]] && [[ -z "$CUSTOM_SSL_CERT" ]]; then
        log_error "--ssl-key requires --ssl-cert"
        exit 1
    fi

    # If domain is set, auto-configure APP_URL if not provided
    if [[ -n "$DOMAIN" ]] && [[ -z "$APP_URL" ]]; then
        APP_URL="https://${DOMAIN}"
        log_info "Auto-configured APP_URL: $APP_URL"
    fi
}

detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS_TYPE="linux"
        # Only set default DEPLOY_DIR if not provided via CLI
        if [[ -z "$DEPLOY_DIR" ]]; then
            DEPLOY_DIR="/www/compose/claude-code-hub"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS_TYPE="macos"
        # Only set default DEPLOY_DIR if not provided via CLI
        if [[ -z "$DEPLOY_DIR" ]]; then
            DEPLOY_DIR="$HOME/Applications/claude-code-hub"
        fi
    else
        log_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
    log_info "Detected OS: $OS_TYPE"
    log_info "Deployment directory: $DEPLOY_DIR"
}

select_branch() {
    # If branch was already set via CLI args, skip interactive selection
    if [[ "$NON_INTERACTIVE" == true ]] || [[ -n "${CCH_BRANCH:-}" ]]; then
        # Branch already validated in parse_args, just log the selection
        log_success "Selected branch: $BRANCH_NAME (image tag: $IMAGE_TAG)"
        return
    fi

    echo ""
    echo -e "${BLUE}Please select the branch to deploy:${NC}"
    echo -e "  ${GREEN}1)${NC} main   (Stable release - recommended for production)"
    echo -e "  ${YELLOW}2)${NC} dev    (Latest features - for testing)"
    echo ""

    local choice
    while true; do
        read -p "Enter your choice [1]: " choice
        choice=${choice:-1}

        case $choice in
            1)
                IMAGE_TAG="latest"
                BRANCH_NAME="main"
                log_success "Selected branch: main (image tag: latest)"
                break
                ;;
            2)
                IMAGE_TAG="dev"
                BRANCH_NAME="dev"
                log_success "Selected branch: dev (image tag: dev)"
                break
                ;;
            *)
                log_error "Invalid choice. Please enter 1 or 2."
                ;;
        esac
    done
}

check_docker() {
    log_info "Checking Docker installation..."
    
    if ! command -v docker &> /dev/null; then
        log_warning "Docker is not installed"
        return 1
    fi
    
    if ! docker compose version &> /dev/null && ! docker-compose --version &> /dev/null; then
        log_warning "Docker Compose is not installed"
        return 1
    fi
    
    log_success "Docker and Docker Compose are installed"
    docker --version
    docker compose version 2>/dev/null || docker-compose --version
    return 0
}

install_docker() {
    log_info "Installing Docker..."
    
    if [[ "$OS_TYPE" == "linux" ]]; then
        if [[ $EUID -ne 0 ]]; then
            log_error "Docker installation requires root privileges on Linux"
            log_info "Please run: sudo $0"
            exit 1
        fi
    fi
    
    log_info "Downloading Docker installation script from get.docker.com..."
    if curl -fsSL https://get.docker.com -o /tmp/get-docker.sh; then
        log_info "Running Docker installation script..."
        sh /tmp/get-docker.sh
        rm /tmp/get-docker.sh
        
        if [[ "$OS_TYPE" == "linux" ]]; then
            log_info "Starting Docker service..."
            systemctl start docker
            systemctl enable docker
            
            if [[ -n "$SUDO_USER" ]]; then
                log_info "Adding user $SUDO_USER to docker group..."
                usermod -aG docker "$SUDO_USER"
                log_warning "Please log out and log back in for group changes to take effect"
            fi
        fi
        
        log_success "Docker installed successfully"
    else
        log_error "Failed to download Docker installation script"
        exit 1
    fi
}

generate_random_suffix() {
    SUFFIX=$(tr -dc 'a-z0-9' < /dev/urandom | head -c 4)
    log_info "Generated random suffix: $SUFFIX"
}

generate_admin_token() {
    if command -v openssl &> /dev/null; then
        ADMIN_TOKEN=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
    else
        ADMIN_TOKEN=$(cat /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 32)
    fi
    log_info "Generated secure admin token"
}

generate_db_password() {
    if command -v openssl &> /dev/null; then
        DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
    else
        DB_PASSWORD=$(cat /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 24)
    fi
    log_info "Generated secure database password"
}

create_deployment_dir() {
    log_info "Creating deployment directory: $DEPLOY_DIR"

    if [[ "$OS_TYPE" == "linux" ]] && [[ ! -d "/www" ]]; then
        if [[ $EUID -ne 0 ]]; then
            log_error "Creating /www directory requires root privileges"
            log_info "Please run: sudo $0"
            exit 1
        fi
        mkdir -p "$DEPLOY_DIR"
        if [[ -n "$SUDO_USER" ]]; then
            chown -R "$SUDO_USER:$SUDO_USER" /www
        fi
    else
        mkdir -p "$DEPLOY_DIR"
    fi

    mkdir -p "$DEPLOY_DIR/data/postgres"
    mkdir -p "$DEPLOY_DIR/data/redis"

    # Create Caddy data directories if domain is configured
    if [[ -n "$DOMAIN" ]]; then
        mkdir -p "$DEPLOY_DIR/data/caddy"
        mkdir -p "$DEPLOY_DIR/data/caddy_config"
    fi

    log_success "Deployment directory created"
}

check_ports() {
    local ports=("$@")
    local port_in_use=false

    for port in "${ports[@]}"; do
        if command -v ss &> /dev/null; then
            if ss -tuln | grep -q ":${port} "; then
                log_warning "Port $port is already in use"
                port_in_use=true
            fi
        elif command -v netstat &> /dev/null; then
            if netstat -tuln | grep -q ":${port} "; then
                log_warning "Port $port is already in use"
                port_in_use=true
            fi
        elif command -v lsof &> /dev/null; then
            if lsof -i ":${port}" &> /dev/null; then
                log_warning "Port $port is already in use"
                port_in_use=true
            fi
        fi
    done

    if [[ "$port_in_use" == true ]]; then
        return 1
    fi
    return 0
}

write_caddyfile() {
    log_info "Writing Caddyfile for domain: $DOMAIN"

    local email_config=""
    if [[ -n "$CADDY_EMAIL" ]]; then
        email_config="
{
    email $CADDY_EMAIL
}
"
    fi

    local tls_config=""
    if [[ -n "$CUSTOM_SSL_CERT" ]] && [[ -n "$CUSTOM_SSL_KEY" ]]; then
        tls_config="    tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem"
    fi

    local redirect_config=""
    if [[ "$NO_HTTPS_REDIRECT" != true ]]; then
        redirect_config="
http://${DOMAIN} {
    redir https://{host}{uri} permanent
}"
    fi

    cat > "$DEPLOY_DIR/Caddyfile" << EOF
${email_config}${DOMAIN} {
    reverse_proxy app:${APP_PORT}
    encode gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        X-XSS-Protection "1; mode=block"
        Referrer-Policy strict-origin-when-cross-origin
    }
${tls_config}
}
${redirect_config}
EOF

    log_success "Caddyfile created"
}

setup_caddy() {
    log_info "Setting up Caddy reverse proxy..."

    # Check if ports 80 and 443 are available
    if ! check_ports 80 443; then
        log_warning "Ports 80 and/or 443 are in use. Caddy may not start correctly."
        if [[ "$NON_INTERACTIVE" != true ]]; then
            read -p "Continue anyway? [y/N]: " confirm
            if [[ "${confirm,,}" != "y" ]]; then
                log_error "Aborted by user"
                exit 1
            fi
        else
            log_warning "Continuing in non-interactive mode..."
        fi
    fi

    # DNS reminder
    echo ""
    log_warning "IMPORTANT: Ensure DNS A record for '$DOMAIN' points to this server!"
    log_info "Let's Encrypt requires the domain to resolve correctly for HTTPS certificates."
    if [[ "$NON_INTERACTIVE" != true ]]; then
        read -p "Press Enter to continue when DNS is configured..."
    fi
    echo ""

    # Write Caddyfile
    write_caddyfile

    # Copy custom SSL certificates if provided
    if [[ -n "$CUSTOM_SSL_CERT" ]] && [[ -n "$CUSTOM_SSL_KEY" ]]; then
        mkdir -p "$DEPLOY_DIR/certs"
        cp "$CUSTOM_SSL_CERT" "$DEPLOY_DIR/certs/cert.pem"
        cp "$CUSTOM_SSL_KEY" "$DEPLOY_DIR/certs/key.pem"
        log_success "Custom SSL certificates copied"
    fi

    log_success "Caddy configuration completed"
}

write_compose_file() {
    log_info "Writing docker-compose.yaml..."

    # Determine app ports configuration
    local app_ports_config
    if [[ -n "$DOMAIN" ]]; then
        # When using Caddy, don't expose app port externally
        app_ports_config=""
    else
        app_ports_config="
    ports:
      - \"${APP_PORT}:${APP_PORT}\""
    fi

    # Caddy service configuration
    local caddy_service=""
    local caddy_volumes=""
    if [[ -n "$DOMAIN" ]]; then
        caddy_volumes="      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./data/caddy:/data
      - ./data/caddy_config:/config"
        if [[ -n "$CUSTOM_SSL_CERT" ]]; then
            caddy_volumes="${caddy_volumes}
      - ./certs:/etc/caddy/certs:ro"
        fi
        caddy_service="
  caddy:
    image: caddy:2-alpine
    container_name: claude-code-hub-caddy-${SUFFIX}
    restart: unless-stopped
    ports:
      - \"80:80\"
      - \"443:443\"
    volumes:
${caddy_volumes}
    networks:
      - claude-code-hub-net-${SUFFIX}
    depends_on:
      - app
"
    fi

    cat > "$DEPLOY_DIR/docker-compose.yaml" << EOF
services:
  postgres:
    image: postgres:18
    container_name: claude-code-hub-db-${SUFFIX}
    restart: unless-stopped
    ports:
      - "35432:5432"
    env_file:
      - ./.env
    environment:
      POSTGRES_USER: \${DB_USER:-postgres}
      POSTGRES_PASSWORD: \${DB_PASSWORD:-postgres}
      POSTGRES_DB: \${DB_NAME:-claude_code_hub}
      PGDATA: /data/pgdata
      TZ: Asia/Shanghai
      PGTZ: Asia/Shanghai
    volumes:
      - ./data/postgres:/data
    networks:
      - claude-code-hub-net-${SUFFIX}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${DB_USER:-postgres} -d \${DB_NAME:-claude_code_hub}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  redis:
    image: redis:7-alpine
    container_name: claude-code-hub-redis-${SUFFIX}
    restart: unless-stopped
    volumes:
      - ./data/redis:/data
    command: redis-server --appendonly yes
    networks:
      - claude-code-hub-net-${SUFFIX}
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 5s

  app:
    image: ghcr.io/ding113/claude-code-hub:${IMAGE_TAG}
    container_name: claude-code-hub-app-${SUFFIX}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file:
      - ./.env
    environment:
      NODE_ENV: production
      PORT: ${APP_PORT}
      DSN: postgresql://\${DB_USER:-postgres}:\${DB_PASSWORD:-postgres}@claude-code-hub-db-${SUFFIX}:5432/\${DB_NAME:-claude_code_hub}
      REDIS_URL: redis://claude-code-hub-redis-${SUFFIX}:6379
      AUTO_MIGRATE: \${AUTO_MIGRATE:-true}
      ENABLE_RATE_LIMIT: \${ENABLE_RATE_LIMIT:-true}
      SESSION_TTL: \${SESSION_TTL:-300}
      TZ: Asia/Shanghai${app_ports_config}
    restart: unless-stopped
    networks:
      - claude-code-hub-net-${SUFFIX}
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:${APP_PORT}/api/actions/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
${caddy_service}
networks:
  claude-code-hub-net-${SUFFIX}:
    driver: bridge
    name: claude-code-hub-net-${SUFFIX}
EOF

    log_success "docker-compose.yaml created"
}

write_env_file() {
    log_info "Writing .env file..."

    cat > "$DEPLOY_DIR/.env" << EOF
# Admin Token (KEEP THIS SECRET!)
ADMIN_TOKEN=${ADMIN_TOKEN}

# Database Configuration
DB_USER=postgres
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=claude_code_hub

# Application Configuration
APP_PORT=${APP_PORT}
APP_URL=${APP_URL}

# Auto Migration (enabled for first-time setup)
AUTO_MIGRATE=true

# Redis Configuration
ENABLE_RATE_LIMIT=true

# Session Configuration
SESSION_TTL=300
STORE_SESSION_MESSAGES=false

# Cookie Security
ENABLE_SECURE_COOKIES=true

# Circuit Breaker Configuration
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=false

# Environment
NODE_ENV=production
TZ=Asia/Shanghai
LOG_LEVEL=info
EOF

    log_success ".env file created"
}

start_services() {
    log_info "Starting Docker services..."
    
    cd "$DEPLOY_DIR"
    
    if docker compose version &> /dev/null; then
        docker compose pull
        docker compose up -d
    else
        docker-compose pull
        docker-compose up -d
    fi
    
    log_success "Docker services started"
}

wait_for_health() {
    log_info "Waiting for services to become healthy (max 60 seconds)..."
    
    cd "$DEPLOY_DIR"
    
    local max_attempts=12
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        attempt=$((attempt + 1))
        
        local postgres_health=$(docker inspect --format='{{.State.Health.Status}}' "claude-code-hub-db-${SUFFIX}" 2>/dev/null || echo "unknown")
        local redis_health=$(docker inspect --format='{{.State.Health.Status}}' "claude-code-hub-redis-${SUFFIX}" 2>/dev/null || echo "unknown")
        local app_health=$(docker inspect --format='{{.State.Health.Status}}' "claude-code-hub-app-${SUFFIX}" 2>/dev/null || echo "unknown")
        
        log_info "Health status - Postgres: $postgres_health, Redis: $redis_health, App: $app_health"
        
        if [[ "$postgres_health" == "healthy" ]] && [[ "$redis_health" == "healthy" ]] && [[ "$app_health" == "healthy" ]]; then
            log_success "All services are healthy!"
            return 0
        fi
        
        if [ $attempt -lt $max_attempts ]; then
            sleep 5
        fi
    done
    
    log_warning "Services did not become healthy within 60 seconds"
    log_info "You can check the logs with: cd $DEPLOY_DIR && docker compose logs -f"
    return 1
}

get_network_addresses() {
    local addresses=()
    
    if [[ "$OS_TYPE" == "linux" ]]; then
        if command -v ip &> /dev/null; then
            while IFS= read -r line; do
                addresses+=("$line")
            done < <(ip addr show 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '^127\.' | grep -v '^172\.17\.' | grep -v '^169\.254\.')
        elif command -v ifconfig &> /dev/null; then
            while IFS= read -r line; do
                addresses+=("$line")
            done < <(ifconfig 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '^127\.' | grep -v '^172\.17\.' | grep -v '^169\.254\.')
        fi
    elif [[ "$OS_TYPE" == "macos" ]]; then
        while IFS= read -r line; do
            addresses+=("$line")
        done < <(ifconfig 2>/dev/null | grep 'inet ' | awk '{print $2}' | grep -v '^127\.' | grep -v '^169\.254\.')
    fi
    
    addresses+=("localhost")
    
    printf '%s\n' "${addresses[@]}"
}

print_success_message() {
    local addresses=($(get_network_addresses))

    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                                ║${NC}"
    echo -e "${GREEN}║          Claude Code Hub Deployed Successfully!               ║${NC}"
    echo -e "${GREEN}║                                                                ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}Deployment Directory:${NC}"
    echo -e "   $DEPLOY_DIR"
    echo ""
    echo -e "${BLUE}Access URLs:${NC}"
    if [[ -n "$DOMAIN" ]]; then
        echo -e "   ${GREEN}https://${DOMAIN}${NC} (via Caddy with auto HTTPS)"
        echo -e "   ${YELLOW}http://localhost:${APP_PORT}${NC} (internal)"
    else
        for addr in "${addresses[@]}"; do
            echo -e "   ${GREEN}http://${addr}:${APP_PORT}${NC}"
        done
    fi
    echo ""
    echo -e "${BLUE}Admin Token (KEEP THIS SECRET!):${NC}"
    echo -e "   ${YELLOW}${ADMIN_TOKEN}${NC}"
    echo ""
    echo -e "${BLUE}Usage Documentation:${NC}"
    if [[ -n "$DOMAIN" ]]; then
        echo -e "   Chinese: ${GREEN}https://${DOMAIN}/zh-CN/usage-doc${NC}"
        echo -e "   English: ${GREEN}https://${DOMAIN}/en-US/usage-doc${NC}"
    else
        for addr in "${addresses[@]}"; do
            echo -e "   Chinese: ${GREEN}http://${addr}:${APP_PORT}/zh-CN/usage-doc${NC}"
            echo -e "   English: ${GREEN}http://${addr}:${APP_PORT}/en-US/usage-doc${NC}"
            break
        done
    fi
    echo ""
    echo -e "${BLUE}Useful Commands:${NC}"
    echo -e "   View logs:     ${YELLOW}cd $DEPLOY_DIR && docker compose logs -f${NC}"
    echo -e "   Stop services: ${YELLOW}cd $DEPLOY_DIR && docker compose down${NC}"
    echo -e "   Restart:       ${YELLOW}cd $DEPLOY_DIR && docker compose restart${NC}"
    echo ""
    echo -e "${RED}IMPORTANT: Please save the admin token in a secure location!${NC}"
    echo ""
}

main() {
    # Parse CLI arguments first (before printing header)
    parse_args "$@"

    print_header

    detect_os

    if ! check_docker; then
        log_warning "Docker is not installed. Attempting to install..."
        install_docker

        if ! check_docker; then
            log_error "Docker installation failed. Please install Docker manually."
            exit 1
        fi
    fi

    select_branch

    generate_random_suffix

    # Only generate credentials if not provided via CLI/env
    if [[ -z "$ADMIN_TOKEN" ]]; then
        generate_admin_token
    else
        log_info "Using provided admin token"
    fi

    if [[ -z "$DB_PASSWORD" ]]; then
        generate_db_password
    else
        log_info "Using provided database password"
    fi

    create_deployment_dir

    # Setup Caddy if domain is specified
    if [[ -n "$DOMAIN" ]]; then
        setup_caddy
    fi

    write_compose_file
    write_env_file

    start_services

    if wait_for_health; then
        print_success_message
    else
        log_warning "Deployment completed but some services may not be fully healthy yet"
        log_info "Please check the logs: cd $DEPLOY_DIR && docker compose logs -f"
        print_success_message
    fi
}

main "$@"
