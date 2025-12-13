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

# Logging functions (defined early for use in parse_args)
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

# Global variables
SUFFIX=""
ADMIN_TOKEN=""
DB_PASSWORD=""
DEPLOY_DIR=""
OS_TYPE=""
IMAGE_TAG="latest"
BRANCH_NAME="main"
APP_PORT="23000"

# CLI argument variables
BRANCH_ARG=""
PORT_ARG=""
TOKEN_ARG=""
DIR_ARG=""
DOMAIN_ARG=""
ENABLE_CADDY=false
NON_INTERACTIVE=false

show_help() {
    cat << EOF
Claude Code Hub - One-Click Deployment Script v${VERSION}

Usage: $0 [OPTIONS]

Options:
  -b, --branch <name>        Branch to deploy: main (default) or dev
  -p, --port <port>          App external port (default: 23000)
  -t, --admin-token <token>  Custom admin token (default: auto-generated)
  -d, --deploy-dir <path>    Custom deployment directory
      --domain <domain>      Domain for Caddy HTTPS (enables Caddy automatically)
      --enable-caddy         Enable Caddy reverse proxy without HTTPS (HTTP only)
  -y, --yes                  Non-interactive mode (skip prompts, use defaults)
  -h, --help                 Show this help message

Examples:
  $0                                    # Interactive deployment
  $0 -y                                 # Non-interactive with defaults
  $0 -b dev -p 8080 -y                  # Deploy dev branch on port 8080
  $0 -t "my-secure-token" -y            # Use custom admin token
  $0 --domain hub.example.com -y        # Deploy with Caddy HTTPS
  $0 --enable-caddy -y                  # Deploy with Caddy HTTP-only

For more information, visit: https://github.com/ding113/claude-code-hub
EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -b|--branch)
                if [[ -z "${2:-}" ]] || [[ "$2" == -* ]]; then
                    log_error "Option $1 requires an argument"
                    exit 1
                fi
                BRANCH_ARG="$2"
                shift 2
                ;;
            -p|--port)
                if [[ -z "${2:-}" ]] || [[ "$2" == -* ]]; then
                    log_error "Option $1 requires an argument"
                    exit 1
                fi
                PORT_ARG="$2"
                shift 2
                ;;
            -t|--admin-token)
                if [[ -z "${2:-}" ]] || [[ "$2" == -* ]]; then
                    log_error "Option $1 requires an argument"
                    exit 1
                fi
                TOKEN_ARG="$2"
                shift 2
                ;;
            -d|--deploy-dir)
                if [[ -z "${2:-}" ]] || [[ "$2" == -* ]]; then
                    log_error "Option $1 requires an argument"
                    exit 1
                fi
                DIR_ARG="$2"
                shift 2
                ;;
            --domain)
                if [[ -z "${2:-}" ]] || [[ "$2" == -* ]]; then
                    log_error "Option $1 requires an argument"
                    exit 1
                fi
                DOMAIN_ARG="$2"
                ENABLE_CADDY=true
                shift 2
                ;;
            --enable-caddy)
                ENABLE_CADDY=true
                shift
                ;;
            -y|--yes)
                NON_INTERACTIVE=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                echo ""
                show_help
                exit 1
                ;;
        esac
    done
}

validate_inputs() {
    # Validate port
    if [[ -n "$PORT_ARG" ]]; then
        if ! [[ "$PORT_ARG" =~ ^[0-9]+$ ]] || [[ "$PORT_ARG" -lt 1 ]] || [[ "$PORT_ARG" -gt 65535 ]]; then
            log_error "Invalid port number: $PORT_ARG (must be 1-65535)"
            exit 1
        fi
        APP_PORT="$PORT_ARG"
    fi

    # Validate admin token length
    if [[ -n "$TOKEN_ARG" ]]; then
        if [[ ${#TOKEN_ARG} -lt 16 ]]; then
            log_error "Admin token too short: minimum 16 characters required"
            exit 1
        fi
        ADMIN_TOKEN="$TOKEN_ARG"
    fi

    # Validate branch
    if [[ -n "$BRANCH_ARG" ]]; then
        case "$BRANCH_ARG" in
            main)
                IMAGE_TAG="latest"
                BRANCH_NAME="main"
                ;;
            dev)
                IMAGE_TAG="dev"
                BRANCH_NAME="dev"
                ;;
            *)
                log_error "Invalid branch: $BRANCH_ARG (must be 'main' or 'dev')"
                exit 1
                ;;
        esac
    fi

    # Apply custom deploy directory
    if [[ -n "$DIR_ARG" ]]; then
        DEPLOY_DIR="$DIR_ARG"
    fi

    # Validate domain format if provided
    if [[ -n "$DOMAIN_ARG" ]]; then
        if ! [[ "$DOMAIN_ARG" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$ ]]; then
            log_error "Invalid domain format: $DOMAIN_ARG"
            exit 1
        fi
    fi
}

print_header() {
    echo -e "${BLUE}"
    echo "+=================================================================+"
    echo "|                                                                 |"
    echo "|           Claude Code Hub - One-Click Deployment               |"
    echo "|                      Version ${VERSION}                             |"
    echo "|                                                                 |"
    echo "+=================================================================+"
    echo -e "${NC}"
}

detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS_TYPE="linux"
        DEPLOY_DIR="/www/compose/claude-code-hub"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS_TYPE="macos"
        DEPLOY_DIR="$HOME/Applications/claude-code-hub"
    else
        log_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
    log_info "Detected OS: $OS_TYPE"
}

select_branch() {
    # Skip if branch already set via CLI or non-interactive mode
    if [[ -n "$BRANCH_ARG" ]]; then
        log_info "Using branch from CLI argument: $BRANCH_NAME"
        return
    fi

    if [[ "$NON_INTERACTIVE" == true ]]; then
        log_info "Non-interactive mode: using default branch (main)"
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
    local temp_script
    temp_script=$(mktemp)
    if curl -fsSL https://get.docker.com -o "$temp_script"; then
        log_info "Running Docker installation script..."
        sh "$temp_script"
        rm -f "$temp_script"
        
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
    # Skip if token already set via CLI
    if [[ -n "$ADMIN_TOKEN" ]]; then
        log_info "Using admin token from CLI argument"
        return
    fi

    if command -v openssl &> /dev/null; then
        ADMIN_TOKEN=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
    else
        ADMIN_TOKEN=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
    fi
    log_info "Generated secure admin token"
}

generate_db_password() {
    if command -v openssl &> /dev/null; then
        DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
    else
        DB_PASSWORD=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)
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
    
    log_success "Deployment directory created"
}

write_compose_file() {
    log_info "Writing docker-compose.yaml..."
    
    # Determine app ports configuration
    local app_ports_config
    if [[ "$ENABLE_CADDY" == true ]]; then
        # When Caddy is enabled, don't expose app port externally
        app_ports_config=""
    else
        app_ports_config="ports:
      - \"\${APP_PORT:-${APP_PORT}}:\${APP_PORT:-${APP_PORT}}\""
    fi

    cat > "$DEPLOY_DIR/docker-compose.yaml" << EOF
services:
  postgres:
    image: postgres:18
    container_name: claude-code-hub-db-${SUFFIX}
    restart: unless-stopped
    ports:
      - "127.0.0.1:35432:5432"
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
      PORT: \${APP_PORT:-${APP_PORT}}
      DSN: postgresql://\${DB_USER:-postgres}:\${DB_PASSWORD:-postgres}@claude-code-hub-db-${SUFFIX}:5432/\${DB_NAME:-claude_code_hub}
      REDIS_URL: redis://claude-code-hub-redis-${SUFFIX}:6379
      AUTO_MIGRATE: \${AUTO_MIGRATE:-true}
      ENABLE_RATE_LIMIT: \${ENABLE_RATE_LIMIT:-true}
      SESSION_TTL: \${SESSION_TTL:-300}
      TZ: Asia/Shanghai
EOF

    # Add app ports only if Caddy is not enabled
    if [[ "$ENABLE_CADDY" != true ]]; then
        cat >> "$DEPLOY_DIR/docker-compose.yaml" << EOF
    ports:
      - "\${APP_PORT:-${APP_PORT}}:\${APP_PORT:-${APP_PORT}}"
EOF
    fi

    cat >> "$DEPLOY_DIR/docker-compose.yaml" << EOF
    restart: unless-stopped
    networks:
      - claude-code-hub-net-${SUFFIX}
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:\${APP_PORT:-${APP_PORT}}/api/actions/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
EOF

    # Add Caddy service if enabled
    if [[ "$ENABLE_CADDY" == true ]]; then
        cat >> "$DEPLOY_DIR/docker-compose.yaml" << EOF

  caddy:
    image: caddy:2-alpine
    container_name: claude-code-hub-caddy-${SUFFIX}
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      app:
        condition: service_healthy
    networks:
      - claude-code-hub-net-${SUFFIX}
EOF
    fi

    cat >> "$DEPLOY_DIR/docker-compose.yaml" << EOF

networks:
  claude-code-hub-net-${SUFFIX}:
    driver: bridge
    name: claude-code-hub-net-${SUFFIX}
EOF

    # Add Caddy volumes if enabled
    if [[ "$ENABLE_CADDY" == true ]]; then
        cat >> "$DEPLOY_DIR/docker-compose.yaml" << EOF

volumes:
  caddy_data:
  caddy_config:
EOF
    fi
    
    log_success "docker-compose.yaml created"
}

write_caddyfile() {
    if [[ "$ENABLE_CADDY" != true ]]; then
        return
    fi

    log_info "Writing Caddyfile..."

    if [[ -n "$DOMAIN_ARG" ]]; then
        # HTTPS mode with domain (Let's Encrypt automatic)
        cat > "$DEPLOY_DIR/Caddyfile" << EOF
${DOMAIN_ARG} {
    reverse_proxy app:${APP_PORT}
    encode gzip
}
EOF
        log_success "Caddyfile created (HTTPS mode with domain: $DOMAIN_ARG)"
    else
        # HTTP-only mode
        cat > "$DEPLOY_DIR/Caddyfile" << EOF
:80 {
    reverse_proxy app:${APP_PORT}
    encode gzip
}
EOF
        log_success "Caddyfile created (HTTP-only mode)"
    fi
}

write_env_file() {
    log_info "Writing .env file..."
    
    # Determine secure cookies setting based on Caddy and domain
    local secure_cookies="true"
    if [[ "$ENABLE_CADDY" == true ]] && [[ -z "$DOMAIN_ARG" ]]; then
        # HTTP-only Caddy mode - disable secure cookies
        secure_cookies="false"
    fi

    # If domain is set, APP_URL should use https
    local app_url=""
    if [[ -n "$DOMAIN_ARG" ]]; then
        app_url="https://${DOMAIN_ARG}"
    fi
    
    cat > "$DEPLOY_DIR/.env" << EOF
# Admin Token (KEEP THIS SECRET!)
ADMIN_TOKEN=${ADMIN_TOKEN}

# Database Configuration
DB_USER=postgres
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=claude_code_hub

# Application Configuration
APP_PORT=${APP_PORT}
APP_URL=${app_url}

# Auto Migration (enabled for first-time setup)
AUTO_MIGRATE=true

# Redis Configuration
ENABLE_RATE_LIMIT=true

# Session Configuration
SESSION_TTL=300
STORE_SESSION_MESSAGES=false

# Cookie Security
ENABLE_SECURE_COOKIES=${secure_cookies}

# Circuit Breaker Configuration
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=false

# Environment
NODE_ENV=production
TZ=Asia/Shanghai
LOG_LEVEL=info
EOF

    # W-015: 设置 .env 文件权限，防止敏感信息泄露
    chmod 600 "$DEPLOY_DIR/.env"

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
    echo -e "${GREEN}+================================================================+${NC}"
    echo -e "${GREEN}|                                                                |${NC}"
    echo -e "${GREEN}|          Claude Code Hub Deployed Successfully!               |${NC}"
    echo -e "${GREEN}|                                                                |${NC}"
    echo -e "${GREEN}+================================================================+${NC}"
    echo ""
    echo -e "${BLUE}Deployment Directory:${NC}"
    echo -e "   $DEPLOY_DIR"
    echo ""
    echo -e "${BLUE}Access URLs:${NC}"

    if [[ "$ENABLE_CADDY" == true ]]; then
        if [[ -n "$DOMAIN_ARG" ]]; then
            # HTTPS mode with domain
            echo -e "   ${GREEN}https://${DOMAIN_ARG}${NC}"
        else
            # HTTP-only Caddy mode
            for addr in "${addresses[@]}"; do
                echo -e "   ${GREEN}http://${addr}${NC}"
            done
        fi
    else
        # Direct app access
        for addr in "${addresses[@]}"; do
            echo -e "   ${GREEN}http://${addr}:${APP_PORT}${NC}"
        done
    fi

    echo ""
    echo -e "${BLUE}Admin Token (KEEP THIS SECRET!):${NC}"
    echo -e "   ${YELLOW}${ADMIN_TOKEN}${NC}"
    echo ""
    echo -e "${BLUE}Usage Documentation:${NC}"
    if [[ "$ENABLE_CADDY" == true ]] && [[ -n "$DOMAIN_ARG" ]]; then
        echo -e "   Chinese: ${GREEN}https://${DOMAIN_ARG}/zh-CN/usage-doc${NC}"
        echo -e "   English: ${GREEN}https://${DOMAIN_ARG}/en-US/usage-doc${NC}"
    else
        local first_addr="${addresses[0]}"
        local port_suffix=""
        if [[ "$ENABLE_CADDY" != true ]]; then
            port_suffix=":${APP_PORT}"
        fi
        echo -e "   Chinese: ${GREEN}http://${first_addr}${port_suffix}/zh-CN/usage-doc${NC}"
        echo -e "   English: ${GREEN}http://${first_addr}${port_suffix}/en-US/usage-doc${NC}"
    fi
    echo ""
    echo -e "${BLUE}Useful Commands:${NC}"
    echo -e "   View logs:    ${YELLOW}cd $DEPLOY_DIR && docker compose logs -f${NC}"
    echo -e "   Stop services: ${YELLOW}cd $DEPLOY_DIR && docker compose down${NC}"
    echo -e "   Restart:      ${YELLOW}cd $DEPLOY_DIR && docker compose restart${NC}"

    if [[ "$ENABLE_CADDY" == true ]]; then
        echo ""
        echo -e "${BLUE}Caddy Configuration:${NC}"
        if [[ -n "$DOMAIN_ARG" ]]; then
            echo -e "   Mode: HTTPS with Let's Encrypt (domain: $DOMAIN_ARG)"
            echo -e "   Ports: 80 (HTTP redirect), 443 (HTTPS)"
        else
            echo -e "   Mode: HTTP-only reverse proxy"
            echo -e "   Port: 80"
        fi
    fi

    echo ""
    echo -e "${RED}IMPORTANT: Please save the admin token in a secure location!${NC}"
    echo ""
}

main() {
    # Parse CLI arguments first
    parse_args "$@"
    
    print_header
    
    detect_os
    
    # Apply CLI overrides after OS detection (for deploy dir)
    validate_inputs
    
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
    generate_admin_token
    generate_db_password
    
    create_deployment_dir
    write_compose_file
    write_caddyfile
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
