# Claude Code Hub - One-Click Deployment Script for Windows
# PowerShell 5.1+ required

#Requires -Version 5.1

[CmdletBinding()]
param(
    [Alias("b")]
    [ValidateSet("main", "dev", "")]
    [string]$Branch = "",
    
    [Alias("p")]
    [ValidateRange(1, 65535)]
    [int]$Port = 0,
    
    [Alias("t")]
    [string]$AdminToken = "",
    
    [Alias("d")]
    [string]$DeployDir = "",
    
    [string]$Domain = "",
    
    [switch]$EnableCaddy,
    
    [Alias("y")]
    [switch]$Yes,
    
    [Alias("h")]
    [switch]$Help
)

# Script version
$VERSION = "1.1.0"

# Global variables
$script:SUFFIX = ""
$script:ADMIN_TOKEN = ""
$script:DB_PASSWORD = ""
$script:DEPLOY_DIR = "C:\ProgramData\claude-code-hub"
$script:IMAGE_TAG = "latest"
$script:BRANCH_NAME = "main"
$script:APP_PORT = "23000"
$script:ENABLE_CADDY = $false
$script:DOMAIN_ARG = ""

function Show-Help {
    $helpText = @"
Claude Code Hub - One-Click Deployment Script v$VERSION

Usage: .\deploy.ps1 [OPTIONS]

Options:
  -Branch, -b <name>         Branch to deploy: main (default) or dev
  -Port, -p <port>           App external port (default: 23000)
  -AdminToken, -t <token>    Custom admin token (default: auto-generated)
  -DeployDir, -d <path>      Custom deployment directory
  -Domain <domain>           Domain for Caddy HTTPS (enables Caddy automatically)
  -EnableCaddy               Enable Caddy reverse proxy without HTTPS (HTTP only)
  -Yes, -y                   Non-interactive mode (skip prompts, use defaults)
  -Help, -h                  Show this help message

Examples:
  .\deploy.ps1                                    # Interactive deployment
  .\deploy.ps1 -Yes                               # Non-interactive with defaults
  .\deploy.ps1 -Branch dev -Port 8080 -Yes        # Deploy dev branch on port 8080
  .\deploy.ps1 -AdminToken "my-secure-token" -Yes # Use custom admin token
  .\deploy.ps1 -Domain hub.example.com -Yes       # Deploy with Caddy HTTPS
  .\deploy.ps1 -EnableCaddy -Yes                  # Deploy with Caddy HTTP-only

For more information, visit: https://github.com/ding113/claude-code-hub
"@
    Write-Host $helpText
}

function Initialize-Parameters {
    # Apply CLI parameters
    if ($Branch) {
        if ($Branch -eq "main") {
            $script:IMAGE_TAG = "latest"
            $script:BRANCH_NAME = "main"
        } elseif ($Branch -eq "dev") {
            $script:IMAGE_TAG = "dev"
            $script:BRANCH_NAME = "dev"
        }
    }
    
    if ($Port -gt 0) {
        $script:APP_PORT = $Port.ToString()
    }
    
    if ($AdminToken) {
        if ($AdminToken.Length -lt 16) {
            Write-ColorOutput "Admin token too short: minimum 16 characters required" -Type Error
            exit 1
        }
        $script:ADMIN_TOKEN = $AdminToken
    }
    
    if ($DeployDir) {
        $script:DEPLOY_DIR = $DeployDir
    }
    
    if ($Domain) {
        # Validate domain format
        if ($Domain -notmatch '^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$') {
            Write-ColorOutput "Invalid domain format: $Domain" -Type Error
            exit 1
        }
        $script:DOMAIN_ARG = $Domain
        $script:ENABLE_CADDY = $true
    }
    
    if ($EnableCaddy) {
        $script:ENABLE_CADDY = $true
    }
}

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
    Write-ColorOutput "+=================================================================+" -Type Header
    Write-ColorOutput "|                                                                 |" -Type Header
    Write-ColorOutput "|           Claude Code Hub - One-Click Deployment               |" -Type Header
    Write-ColorOutput "|                      Version $VERSION                             |" -Type Header
    Write-ColorOutput "|                                                                 |" -Type Header
    Write-ColorOutput "+=================================================================+" -Type Header
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
    # Skip if branch already set via CLI or non-interactive mode
    if ($Branch) {
        Write-ColorOutput "Using branch from CLI argument: $script:BRANCH_NAME" -Type Info
        return
    }
    
    if ($Yes) {
        Write-ColorOutput "Non-interactive mode: using default branch (main)" -Type Info
        return
    }

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
    # Skip if token already set via CLI
    if ($script:ADMIN_TOKEN) {
        Write-ColorOutput "Using admin token from CLI argument" -Type Info
        return
    }

    # Generate more bytes to ensure we have enough after removing special chars
    $bytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $token = [Convert]::ToBase64String($bytes) -replace '[/+=]', ''
    $script:ADMIN_TOKEN = $token.Substring(0, [Math]::Min(32, $token.Length))
    Write-ColorOutput "Generated secure admin token" -Type Info
}

function New-DbPassword {
    # Generate more bytes to ensure we have enough after removing special chars
    $bytes = New-Object byte[] 36
    $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $password = [Convert]::ToBase64String($bytes) -replace '[/+=]', ''
    $script:DB_PASSWORD = $password.Substring(0, [Math]::Min(24, $password.Length))
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
    
    # Build ports section for app (only if Caddy is not enabled)
    $appPortsSection = ""
    if (-not $script:ENABLE_CADDY) {
        $appPortsSection = @"
    ports:
      - "`${APP_PORT:-$($script:APP_PORT)}:`${APP_PORT:-$($script:APP_PORT)}"
"@
    }

    $composeContent = @"
services:
  postgres:
    image: postgres:18
    container_name: claude-code-hub-db-$SUFFIX
    restart: unless-stopped
    ports:
      - "127.0.0.1:35432:5432"
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
      PORT: `${APP_PORT:-$($script:APP_PORT)}
      DSN: postgresql://`${DB_USER:-postgres}:`${DB_PASSWORD:-postgres}@claude-code-hub-db-${SUFFIX}:5432/`${DB_NAME:-claude_code_hub}
      REDIS_URL: redis://claude-code-hub-redis-${SUFFIX}:6379
      AUTO_MIGRATE: `${AUTO_MIGRATE:-true}
      ENABLE_RATE_LIMIT: `${ENABLE_RATE_LIMIT:-true}
      SESSION_TTL: `${SESSION_TTL:-300}
      TZ: Asia/Shanghai
$appPortsSection
    restart: unless-stopped
    networks:
      - claude-code-hub-net-$SUFFIX
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:`${APP_PORT:-$($script:APP_PORT)}/api/actions/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
"@

    # Add Caddy service if enabled
    if ($script:ENABLE_CADDY) {
        $composeContent += @"

  caddy:
    image: caddy:2-alpine
    container_name: claude-code-hub-caddy-$SUFFIX
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
      - claude-code-hub-net-$SUFFIX
"@
    }

    $composeContent += @"

networks:
  claude-code-hub-net-${SUFFIX}:
    driver: bridge
    name: claude-code-hub-net-$SUFFIX
"@

    # Add Caddy volumes if enabled
    if ($script:ENABLE_CADDY) {
        $composeContent += @"

volumes:
  caddy_data:
  caddy_config:
"@
    }
    
    try {
        Set-Content -Path "$DEPLOY_DIR\docker-compose.yaml" -Value $composeContent -Encoding UTF8
        Write-ColorOutput "docker-compose.yaml created" -Type Success
    }
    catch {
        Write-ColorOutput "Failed to write docker-compose.yaml: $_" -Type Error
        exit 1
    }
}

function Write-Caddyfile {
    if (-not $script:ENABLE_CADDY) {
        return
    }

    Write-ColorOutput "Writing Caddyfile..." -Type Info

    if ($script:DOMAIN_ARG) {
        # HTTPS mode with domain (Let's Encrypt automatic)
        $caddyContent = @"
$($script:DOMAIN_ARG) {
    reverse_proxy app:$($script:APP_PORT)
    encode gzip
}
"@
        Write-ColorOutput "Caddyfile created (HTTPS mode with domain: $($script:DOMAIN_ARG))" -Type Success
    }
    else {
        # HTTP-only mode
        $caddyContent = @"
:80 {
    reverse_proxy app:$($script:APP_PORT)
    encode gzip
}
"@
        Write-ColorOutput "Caddyfile created (HTTP-only mode)" -Type Success
    }

    try {
        Set-Content -Path "$DEPLOY_DIR\Caddyfile" -Value $caddyContent -Encoding UTF8
    }
    catch {
        Write-ColorOutput "Failed to write Caddyfile: $_" -Type Error
        exit 1
    }
}

function Write-EnvFile {
    Write-ColorOutput "Writing .env file..." -Type Info
    
    # Determine secure cookies setting based on Caddy and domain
    $secureCookies = "true"
    if ($script:ENABLE_CADDY -and -not $script:DOMAIN_ARG) {
        # HTTP-only Caddy mode - disable secure cookies
        $secureCookies = "false"
    }

    # If domain is set, APP_URL should use https
    $appUrl = ""
    if ($script:DOMAIN_ARG) {
        $appUrl = "https://$($script:DOMAIN_ARG)"
    }
    
    $envContent = @"
# Admin Token (KEEP THIS SECRET!)
ADMIN_TOKEN=$ADMIN_TOKEN

# Database Configuration
DB_USER=postgres
DB_PASSWORD=$DB_PASSWORD
DB_NAME=claude_code_hub

# Application Configuration
APP_PORT=$($script:APP_PORT)
APP_URL=$appUrl

# Auto Migration (enabled for first-time setup)
AUTO_MIGRATE=true

# Redis Configuration
ENABLE_RATE_LIMIT=true

# Session Configuration
SESSION_TTL=300
STORE_SESSION_MESSAGES=false

# Cookie Security
ENABLE_SECURE_COOKIES=$secureCookies

# Circuit Breaker Configuration
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=false

# Environment
NODE_ENV=production
TZ=Asia/Shanghai
LOG_LEVEL=info
"@
    
    try {
        Set-Content -Path "$DEPLOY_DIR\.env" -Value $envContent -Encoding UTF8

        # W-015: Restrict .env file permissions (equivalent to chmod 600)
        # Remove inheritance and set owner-only access
        $envFile = "$DEPLOY_DIR\.env"
        $acl = Get-Acl $envFile
        $acl.SetAccessRuleProtection($true, $false)  # Disable inheritance, don't copy existing rules
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $currentUser,
            "FullControl",
            "Allow"
        )
        $acl.SetAccessRule($accessRule)
        Set-Acl -Path $envFile -AclObject $acl

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
    Write-Host "+================================================================+" -ForegroundColor Green
    Write-Host "|                                                                |" -ForegroundColor Green
    Write-Host "|          Claude Code Hub Deployed Successfully!               |" -ForegroundColor Green
    Write-Host "|                                                                |" -ForegroundColor Green
    Write-Host "+================================================================+" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "Deployment Directory:" -ForegroundColor Blue
    Write-Host "   $DEPLOY_DIR"
    Write-Host ""
    
    Write-Host "Access URLs:" -ForegroundColor Blue
    if ($script:ENABLE_CADDY) {
        if ($script:DOMAIN_ARG) {
            # HTTPS mode with domain
            Write-Host "   https://$($script:DOMAIN_ARG)" -ForegroundColor Green
        }
        else {
            # HTTP-only Caddy mode
            foreach ($addr in $addresses) {
                Write-Host "   http://${addr}" -ForegroundColor Green
            }
        }
    }
    else {
        # Direct app access
        foreach ($addr in $addresses) {
            Write-Host "   http://${addr}:$($script:APP_PORT)" -ForegroundColor Green
        }
    }
    Write-Host ""
    
    Write-Host "Admin Token (KEEP THIS SECRET!):" -ForegroundColor Blue
    Write-Host "   $ADMIN_TOKEN" -ForegroundColor Yellow
    Write-Host ""
    
    Write-Host "Usage Documentation:" -ForegroundColor Blue
    if ($script:ENABLE_CADDY -and $script:DOMAIN_ARG) {
        Write-Host "   Chinese: https://$($script:DOMAIN_ARG)/zh-CN/usage-doc" -ForegroundColor Green
        Write-Host "   English: https://$($script:DOMAIN_ARG)/en-US/usage-doc" -ForegroundColor Green
    }
    else {
        $firstAddr = $addresses[0]
        $portSuffix = ""
        if (-not $script:ENABLE_CADDY) {
            $portSuffix = ":$($script:APP_PORT)"
        }
        Write-Host "   Chinese: http://${firstAddr}${portSuffix}/zh-CN/usage-doc" -ForegroundColor Green
        Write-Host "   English: http://${firstAddr}${portSuffix}/en-US/usage-doc" -ForegroundColor Green
    }
    Write-Host ""
    
    Write-Host "Useful Commands:" -ForegroundColor Blue
    Write-Host "   View logs:     cd $DEPLOY_DIR; docker compose logs -f" -ForegroundColor Yellow
    Write-Host "   Stop services: cd $DEPLOY_DIR; docker compose down" -ForegroundColor Yellow
    Write-Host "   Restart:       cd $DEPLOY_DIR; docker compose restart" -ForegroundColor Yellow

    if ($script:ENABLE_CADDY) {
        Write-Host ""
        Write-Host "Caddy Configuration:" -ForegroundColor Blue
        if ($script:DOMAIN_ARG) {
            Write-Host "   Mode: HTTPS with Let's Encrypt (domain: $($script:DOMAIN_ARG))"
            Write-Host "   Ports: 80 (HTTP redirect), 443 (HTTPS)"
        }
        else {
            Write-Host "   Mode: HTTP-only reverse proxy"
            Write-Host "   Port: 80"
        }
    }

    Write-Host ""
    Write-Host "IMPORTANT: Please save the admin token in a secure location!" -ForegroundColor Red
    Write-Host ""
}

function Main {
    # Handle help flag first
    if ($Help) {
        Show-Help
        exit 0
    }

    # Initialize parameters from CLI args
    Initialize-Parameters

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
    Write-Caddyfile
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
