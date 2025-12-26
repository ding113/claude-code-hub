# ================================
# Claude Code Hub - dev 工具链
# ================================
#
# 目标:
# 1) 通过 Docker 启动 PostgreSQL + Redis（供本机 bun dev 使用）
# 2) 通过 Docker 本地构建 app 镜像并联动 DB/Redis（无需预构建镜像）
#
# 说明:
# - 在项目根目录可直接运行 `make <target>`（根 Makefile 会转发到此处）
# - 可通过环境变量覆盖端口/账号等（见 help）

.PHONY: help dev db app build build-nocache app-rebuild app-nocache prune-images rm-app-image compose clean migrate db-shell redis-shell logs logs-app logs-db logs-redis reset status stop

PROJECT_NAME ?= cch-dev
COMPOSE_FILE ?= docker-compose.yaml
COMPOSE := docker compose -f $(COMPOSE_FILE) -p $(PROJECT_NAME)

# -------- 可配置项（均可通过环境变量覆盖） --------
export DB_USER ?= postgres
export DB_PASSWORD ?= postgres
export DB_NAME ?= claude_code_hub
export POSTGRES_PORT ?= 5432
export REDIS_PORT ?= 6379
export APP_PORT ?= 23000
export ADMIN_TOKEN ?= cch-dev-admin
export APP_VERSION ?= dev
export ENABLE_RATE_LIMIT ?= true

POSTGRES_HOST ?= 127.0.0.1
REDIS_HOST ?= 127.0.0.1

LOCAL_DSN ?= postgres://$(DB_USER):$(DB_PASSWORD)@$(POSTGRES_HOST):$(POSTGRES_PORT)/$(DB_NAME)
LOCAL_REDIS_URL ?= redis://$(REDIS_HOST):$(REDIS_PORT)

help:
	@echo ""
	@echo "Claude Code Hub - dev 工具链"
	@echo ""
	@echo "常用命令:"
	@echo "  make db        启动 PostgreSQL + Redis（Docker）"
	@echo "  make dev       启动 db/redis 后运行 bun dev（连接 Docker db/redis）"
	@echo "  make app       本地构建并启动 app 镜像 + db + redis（无需预构建镜像）"
	@echo "  make build     仅本地构建 app 镜像"
	@echo "  make app-rebuild 强制重建并重建容器（适合代码改动后确保生效）"
	@echo "  make app-nocache 无缓存重建 app 镜像并重建容器（排查构建缓存问题）"
	@echo "  make prune-images 清理悬空(dangling)镜像（解决多次构建残留）"
	@echo "  make rm-app-image 删除本地 app 镜像标签（claude-code-hub-local:*)"
	@echo "  make logs      查看所有服务日志"
	@echo "  make status    查看容器状态"
	@echo "  make clean     停止并删除容器（保留数据）"
	@echo "  make reset     停止并删除容器与数据（危险操作）"
	@echo ""
	@echo "可覆盖环境变量:"
	@echo "  PROJECT_NAME=$(PROJECT_NAME)"
	@echo "  DB_USER=$(DB_USER) DB_PASSWORD=$(DB_PASSWORD) DB_NAME=$(DB_NAME)"
	@echo "  POSTGRES_PORT=$(POSTGRES_PORT) REDIS_PORT=$(REDIS_PORT) APP_PORT=$(APP_PORT)"
	@echo "  ADMIN_TOKEN=$(ADMIN_TOKEN) APP_VERSION=$(APP_VERSION) ENABLE_RATE_LIMIT=$(ENABLE_RATE_LIMIT)"
	@echo ""
	@echo "本机 dev 默认连接串:"
	@echo "  DSN=$(LOCAL_DSN)"
	@echo "  REDIS_URL=$(LOCAL_REDIS_URL)"
	@echo ""

db:
	@$(COMPOSE) up -d postgres redis
	@$(COMPOSE) ps

dev: db
	@echo ""
	@echo "Running bun dev with:"
	@echo "  DSN=$(LOCAL_DSN)"
	@echo "  REDIS_URL=$(LOCAL_REDIS_URL)"
	@echo ""
	@DSN="$(LOCAL_DSN)" REDIS_URL="$(LOCAL_REDIS_URL)" ENABLE_RATE_LIMIT="$(ENABLE_RATE_LIMIT)" \
		ADMIN_TOKEN="$(ADMIN_TOKEN)" bun run dev

build:
	@$(COMPOSE) --profile app build app

build-nocache:
	@$(COMPOSE) --profile app build --no-cache app

app:
	@$(COMPOSE) --profile app up -d --build
	@$(COMPOSE) ps
	@echo ""
	@echo "App is starting. Visit: http://localhost:$(APP_PORT)"
	@echo ""

app-rebuild:
	@$(COMPOSE) --profile app up -d --build --force-recreate
	@$(COMPOSE) ps

app-nocache:
	@$(MAKE) build-nocache
	@$(MAKE) app-rebuild

prune-images:
	@docker image prune -f

rm-app-image:
	@docker image rm -f "claude-code-hub-local:$(APP_VERSION)" 2>/dev/null || true

migrate: db
	@DSN="$(LOCAL_DSN)" bun run db:migrate

db-shell: db
	@$(COMPOSE) exec postgres psql -U "$(DB_USER)" -d "$(DB_NAME)"

redis-shell: db
	@$(COMPOSE) exec redis redis-cli

logs:
	@$(COMPOSE) logs -f --tail=200

logs-app:
	@$(COMPOSE) --profile app logs -f --tail=200 app

logs-db:
	@$(COMPOSE) logs -f --tail=200 postgres

logs-redis:
	@$(COMPOSE) logs -f --tail=200 redis

status:
	@$(COMPOSE) ps

stop:
	@$(COMPOSE) stop

clean:
	@$(COMPOSE) down --remove-orphans

reset:
	@$(COMPOSE) down -v --remove-orphans
	@rm -rf ../data/postgres-dev ../data/redis-dev

compose:
	@echo "$(COMPOSE)"
