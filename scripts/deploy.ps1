# Claude Code Hub - One-Click Deployment Script for Windows
# PowerShell 5.1+ required

#Requires -Version 5.1

# Script version
$VERSION = "1.0.0"

# Global variables
$SUFFIX = ""
$ADMIN_TOKEN = ""
$DB_PASSWORD = ""
$DEPLOY_DIR = "C:\ProgramData\claude-code-hub"
$IMAGE_TAG = "latest"
$BRANCH_NAME = "main"

function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Type = "Info"
    )
    
    switch ($Type) {
        "Header" { Write-Host $Message -ForegroundColor Cyan }
        "Info" { Write-Host "[INFO] $Message" -ForegroundColor Blue }
        "Success" { Write-Host "[SUCCESS] $Message" -ForegroundColor Green }
        "Warning" { Write-Host "[WARNING] $Message" -ForegroundColor Yellow }
        "Error" { Write-Host "[ERROR] $Message" -ForegroundColor Red }
        default { Write-Host $Message }
    }
}

function Show-Header {
    Write-ColorOutput "╔════════════════════════════════════════════════════════════════╗" -Type Header
    Write-ColorOutput "║                                                                ║" -Type Header
    Write-ColorOutput "║           Claude Code Hub - One-Click Deployment              ║" -Type Header
    Write-ColorOutput "║                      Version $VERSION                            ║" -Type Header
    Write-ColorOutput "║                                                                ║" -Type Header
    Write-ColorOutput "╚════════════════════════════════════════════════════════════════╝" -Type Header
    Write-Host ""
}

function Test-DockerInstalled {
    Write-ColorOutput "Checking Docker installation..." -Type Info
    
    try {
        $dockerVersion = docker --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-ColorOutput "Docker is not installed" -Type Warning
            return $false
        }
        
        $composeVersion = docker compose version 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-ColorOutput "Docker Compose is not installed" -Type Warning
            return $false
        }
        
        Write-ColorOutput "Docker and Docker Compose are installed" -Type Success
        Write-Host $dockerVersion
        Write-Host $composeVersion
        return $true
    }
    catch {
        Write-ColorOutput "Docker is not installed" -Type Warning
        return $false
    }
}

function Show-DockerInstallInstructions {
    Write-ColorOutput "Docker is not installed on this system" -Type Error
    Write-Host ""
    Write-ColorOutput "Please install Docker Desktop for Windows:" -Type Info
    Write-Host "  1. Download from: https://www.docker.com/products/docker-desktop/" -ForegroundColor Cyan
    Write-Host "  2. Run the installer and follow the instructions"
    Write-Host "  3. Restart your computer after installation"
    Write-Host "  4. Run this script again"
    Write-Host ""
    Write-ColorOutput "Press any key to open Docker Desktop download page..." -Type Info
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    Start-Process "https://www.docker.com/products/docker-desktop/"
    exit 1
}

function Select-Branch {
    Write-Host ""
    Write-ColorOutput "Please select the branch to deploy:" -Type Info
    Write-Host "  1) main   (Stable release - recommended for production)" -ForegroundColor Green
    Write-Host "  2) dev    (Latest features - for testing)" -ForegroundColor Yellow
    Write-Host ""
    
    while ($true) {
        $choice = Read-Host "Enter your choice [1]"
        if ([string]::IsNullOrWhiteSpace($choice)) {
            $choice = "1"
        }
        
        switch ($choice) {
            "1" {
                $script:IMAGE_TAG = "latest"
                $script:BRANCH_NAME = "main"
                Write-ColorOutput "Selected branch: main (image tag: latest)" -Type Success
                break
            }
            "2" {
                $script:IMAGE_TAG = "dev"
                $script:BRANCH_NAME = "dev"
                Write-ColorOutput "Selected branch: dev (image tag: dev)" -Type Success
                break
            }
            default {
                Write-ColorOutput "Invalid choice. Please enter 1 or 2." -Type Error
                continue
            }
        }
        break
    }
}

function New-RandomSuffix {
    $chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    $script:SUFFIX = -join ((1..4) | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    Write-ColorOutput "Generated random suffix: $SUFFIX" -Type Info
}

function New-AdminToken {
    $bytes = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::Create()
    $rng.GetBytes($bytes)
    $script:ADMIN_TOKEN = [Convert]::ToBase64String($bytes) -replace '[/+=]', '' | Select-Object -First 32
    $script:ADMIN_TOKEN = $script:ADMIN_TOKEN.Substring(0, 32)
    Write-ColorOutput "Generated secure admin token" -Type Info
}

function New-DbPassword {
    $bytes = New-Object byte[] 18
    $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::Create()
    $rng.GetBytes($bytes)
    $script:DB_PASSWORD = [Convert]::ToBase64String($bytes) -replace '[/+=]', '' | Select-Object -First 24
    $script:DB_PASSWORD = $script:DB_PASSWORD.Substring(0, 24)
    Write-ColorOutput "Generated secure database password" -Type Info
}

function New-DeploymentDirectory {
    Write-ColorOutput "Creating deployment directory: $DEPLOY_DIR" -Type Info
    
    try {
        if (-not (Test-Path $DEPLOY_DIR)) {
            New-Item -ItemType Directory -Path $DEPLOY_DIR -Force | Out-Null
        }
        
        New-Item -ItemType Directory -Path "$DEPLOY_DIR\data\postgres" -Force | Out-Null
        New-Item -ItemType Directory -Path "$DEPLOY_DIR\data\redis" -Force | Out-Null
        
        Write-ColorOutput "Deployment directory created" -Type Success
    }
    catch {
        Write-ColorOutput "Failed to create deployment directory: $_" -Type Error
        exit 1
    }
}

function Write-ComposeFile {
    Write-ColorOutput "Writing docker-compose.yaml..." -Type Info
    
    $composeContent = @"
services:
  postgres:
    image: postgres:18
    container_name: claude-code-hub-db-$SUFFIX
    restart: unless-stopped
    ports:
      - "35432:5432"
    env_file:
      - ./.env
    environment:
      POSTGRES_USER: `${DB_USER:-postgres}
      POSTGRES_PASSWORD: `${DB_PASSWORD:-postgres}
      POSTGRES_DB: `${DB_NAME:-claude_code_hub}
      PGDATA: /data/pgdata
      TZ: Asia/Shanghai
      PGTZ: Asia/Shanghai
    volumes:
      - ./data/postgres:/data
    networks:
      - claude-code-hub-net-$SUFFIX
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U `${DB_USER:-postgres} -d `${DB_NAME:-claude_code_hub}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  redis:
    image: redis:7-alpine
    container_name: claude-code-hub-redis-$SUFFIX
    restart: unless-stopped
    volumes:
      - ./data/redis:/data
    command: redis-server --appendonly yes
    networks:
      - claude-code-hub-net-$SUFFIX
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 5s

  app:
    image: ghcr.io/ding113/claude-code-hub:$IMAGE_TAG
    container_name: claude-code-hub-app-$SUFFIX
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file:
      - ./.env
    environment:
      NODE_ENV: production
      PORT: `${APP_PORT:-23000}
      DSN: postgresql://`${DB_USER:-postgres}:`${DB_PASSWORD:-postgres}@claude-code-hub-db-${SUFFIX}:5432/`${DB_NAME:-claude_code_hub}
      REDIS_URL: redis://claude-code-hub-redis-${SUFFIX}:6379
      AUTO_MIGRATE: `${AUTO_MIGRATE:-true}
      ENABLE_RATE_LIMIT: `${ENABLE_RATE_LIMIT:-true}
      SESSION_TTL: `${SESSION_TTL:-300}
      TZ: Asia/Shanghai
    ports:
      - "`${APP_PORT:-23000}:`${APP_PORT:-23000}"
    restart: unless-stopped
    networks:
      - claude-code-hub-net-$SUFFIX
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:`${APP_PORT:-23000}/api/actions/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

networks:
  claude-code-hub-net-${SUFFIX}:
    driver: bridge
    name: claude-code-hub-net-$SUFFIX
"@
    
    try {
        Set-Content -Path "$DEPLOY_DIR\docker-compose.yaml" -Value $composeContent -Encoding UTF8
        Write-ColorOutput "docker-compose.yaml created" -Type Success
    }
    catch {
        Write-ColorOutput "Failed to write docker-compose.yaml: $_" -Type Error
        exit 1
    }
}

function Write-EnvFile {
    Write-ColorOutput "Writing .env file..." -Type Info
    
    $envContent = @"
# Admin Token (KEEP THIS SECRET!)
ADMIN_TOKEN=$ADMIN_TOKEN

# Database Configuration
DB_USER=postgres
DB_PASSWORD=$DB_PASSWORD
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
"@
    
    try {
        Set-Content -Path "$DEPLOY_DIR\.env" -Value $envContent -Encoding UTF8
        Write-ColorOutput ".env file created" -Type Success
    }
    catch {
        Write-ColorOutput "Failed to write .env file: $_" -Type Error
        exit 1
    }
}

function Start-Services {
    Write-ColorOutput "Starting Docker services..." -Type Info
    
    try {
        Push-Location $DEPLOY_DIR
        
        docker compose pull
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to pull Docker images"
        }
        
        docker compose up -d
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to start services"
        }
        
        Pop-Location
        Write-ColorOutput "Docker services started" -Type Success
    }
    catch {
        Pop-Location
        Write-ColorOutput "Failed to start services: $_" -Type Error
        exit 1
    }
}

function Wait-ForHealth {
    Write-ColorOutput "Waiting for services to become healthy (max 60 seconds)..." -Type Info
    
    $maxAttempts = 12
    $attempt = 0
    
    Push-Location $DEPLOY_DIR
    
    while ($attempt -lt $maxAttempts) {
        $attempt++
        
        try {
            $postgresHealth = (docker inspect --format='{{.State.Health.Status}}' "claude-code-hub-db-$SUFFIX" 2>$null)
            $redisHealth = (docker inspect --format='{{.State.Health.Status}}' "claude-code-hub-redis-$SUFFIX" 2>$null)
            $appHealth = (docker inspect --format='{{.State.Health.Status}}' "claude-code-hub-app-$SUFFIX" 2>$null)
            
            if (-not $postgresHealth) { $postgresHealth = "unknown" }
            if (-not $redisHealth) { $redisHealth = "unknown" }
            if (-not $appHealth) { $appHealth = "unknown" }
            
            Write-ColorOutput "Health status - Postgres: $postgresHealth, Redis: $redisHealth, App: $appHealth" -Type Info
            
            if ($postgresHealth -eq "healthy" -and $redisHealth -eq "healthy" -and $appHealth -eq "healthy") {
                Pop-Location
                Write-ColorOutput "All services are healthy!" -Type Success
                return $true
            }
        }
        catch {
            # Continue waiting
        }
        
        if ($attempt -lt $maxAttempts) {
            Start-Sleep -Seconds 5
        }
    }
    
    Pop-Location
    Write-ColorOutput "Services did not become healthy within 60 seconds" -Type Warning
    Write-ColorOutput "You can check the logs with: cd $DEPLOY_DIR; docker compose logs -f" -Type Info
    return $false
}

function Get-NetworkAddresses {
    $addresses = @()
    
    try {
        $adapters = Get-NetIPAddress -AddressFamily IPv4 | 
            Where-Object { 
                $_.InterfaceAlias -notlike '*Loopback*' -and 
                $_.InterfaceAlias -notlike '*Docker*' -and
                $_.IPAddress -notlike '169.254.*'
            }
        
        foreach ($adapter in $adapters) {
            $addresses += $adapter.IPAddress
        }
    }
    catch {
        # Silently continue
    }
    
    $addresses += "localhost"
    return $addresses
}

function Show-SuccessMessage {
    $addresses = Get-NetworkAddresses
    
    Write-Host ""
    Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║                                                                ║" -ForegroundColor Green
    Write-Host "║          🎉 Claude Code Hub Deployed Successfully! 🎉         ║" -ForegroundColor Green
    Write-Host "║                                                                ║" -ForegroundColor Green
    Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "📍 Deployment Directory:" -ForegroundColor Blue
    Write-Host "   $DEPLOY_DIR"
    Write-Host ""
    
    Write-Host "🌐 Access URLs:" -ForegroundColor Blue
    foreach ($addr in $addresses) {
        Write-Host "   http://${addr}:23000" -ForegroundColor Green
    }
    Write-Host ""
    
    Write-Host "🔑 Admin Token (KEEP THIS SECRET!):" -ForegroundColor Blue
    Write-Host "   $ADMIN_TOKEN" -ForegroundColor Yellow
    Write-Host ""
    
    Write-Host "📚 Usage Documentation:" -ForegroundColor Blue
    $firstAddr = $addresses[0]
    Write-Host "   Chinese: http://${firstAddr}:23000/zh-CN/usage-doc" -ForegroundColor Green
    Write-Host "   English: http://${firstAddr}:23000/en-US/usage-doc" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "🔧 Useful Commands:" -ForegroundColor Blue
    Write-Host "   View logs:     cd $DEPLOY_DIR; docker compose logs -f" -ForegroundColor Yellow
    Write-Host "   Stop services: cd $DEPLOY_DIR; docker compose down" -ForegroundColor Yellow
    Write-Host "   Restart:       cd $DEPLOY_DIR; docker compose restart" -ForegroundColor Yellow
    Write-Host ""
    
    Write-Host "⚠️  IMPORTANT: Please save the admin token in a secure location!" -ForegroundColor Red
    Write-Host ""
}

function Main {
    Show-Header
    
    if (-not (Test-DockerInstalled)) {
        Show-DockerInstallInstructions
        exit 1
    }
    
    Select-Branch
    
    New-RandomSuffix
    New-AdminToken
    New-DbPassword
    
    New-DeploymentDirectory
    Write-ComposeFile
    Write-EnvFile
    
    Start-Services
    
    $isHealthy = Wait-ForHealth
    
    if ($isHealthy) {
        Show-SuccessMessage
    }
    else {
        Write-ColorOutput "Deployment completed but some services may not be fully healthy yet" -Type Warning
        Write-ColorOutput "Please check the logs: cd $DEPLOY_DIR; docker compose logs -f" -Type Info
        Show-SuccessMessage
    }
}

# Run main function
Main
