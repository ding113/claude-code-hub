#!/usr/bin/env bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script version
VERSION="1.0.0"

# Global variables
SUFFIX=""
ADMIN_TOKEN=""
DB_PASSWORD=""
DEPLOY_DIR=""
OS_TYPE=""
IMAGE_TAG="latest"
BRANCH_NAME="main"

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
    
    log_success "Deployment directory created"
}

write_compose_file() {
    log_info "Writing docker-compose.yaml..."
    
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
      PORT: \${APP_PORT:-23000}
      DSN: postgresql://\${DB_USER:-postgres}:\${DB_PASSWORD:-postgres}@claude-code-hub-db-${SUFFIX}:5432/\${DB_NAME:-claude_code_hub}
      REDIS_URL: redis://claude-code-hub-redis-${SUFFIX}:6379
      AUTO_MIGRATE: \${AUTO_MIGRATE:-true}
      ENABLE_RATE_LIMIT: \${ENABLE_RATE_LIMIT:-true}
      SESSION_TTL: \${SESSION_TTL:-300}
      TZ: Asia/Shanghai
    ports:
      - "\${APP_PORT:-23000}:\${APP_PORT:-23000}"
    restart: unless-stopped
    networks:
      - claude-code-hub-net-${SUFFIX}
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:\${APP_PORT:-23000}/api/actions/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

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
APP_PORT=23000
APP_URL=

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
    echo -e "${GREEN}║          🎉 Claude Code Hub Deployed Successfully! 🎉         ║${NC}"
    echo -e "${GREEN}║                                                                ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}📍 Deployment Directory:${NC}"
    echo -e "   $DEPLOY_DIR"
    echo ""
    echo -e "${BLUE}🌐 Access URLs:${NC}"
    for addr in "${addresses[@]}"; do
        echo -e "   ${GREEN}http://${addr}:23000${NC}"
    done
    echo ""
    echo -e "${BLUE}🔑 Admin Token (KEEP THIS SECRET!):${NC}"
    echo -e "   ${YELLOW}${ADMIN_TOKEN}${NC}"
    echo ""
    echo -e "${BLUE}📚 Usage Documentation:${NC}"
    for addr in "${addresses[@]}"; do
        echo -e "   Chinese: ${GREEN}http://${addr}:23000/zh-CN/usage-doc${NC}"
        echo -e "   English: ${GREEN}http://${addr}:23000/en-US/usage-doc${NC}"
        break
    done
    echo ""
    echo -e "${BLUE}🔧 Useful Commands:${NC}"
    echo -e "   View logs:    ${YELLOW}cd $DEPLOY_DIR && docker compose logs -f${NC}"
    echo -e "   Stop services: ${YELLOW}cd $DEPLOY_DIR && docker compose down${NC}"
    echo -e "   Restart:      ${YELLOW}cd $DEPLOY_DIR && docker compose restart${NC}"
    echo ""
    echo -e "${RED}⚠️  IMPORTANT: Please save the admin token in a secure location!${NC}"
    echo ""
}

main() {
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
    generate_admin_token
    generate_db_password
    
    create_deployment_dir
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
