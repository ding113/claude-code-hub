# 本地开发（dev 工具链）

本目录提供两种本地开发方式，均使用 Docker 启动的 PostgreSQL + Redis：

1) 本机运行 `bun run dev`，数据库与 Redis 由 Docker 提供
2) Docker 本地构建并运行 app 镜像（无需预构建镜像），数据库与 Redis 由同一 Compose 提供

## 快速开始

在项目根目录执行（根目录 Makefile 会自动转发到 `dev/`）：

- 启动 DB/Redis（暴露到本机端口，供本机 bun dev 访问）：
  - `make db`
- 启动 DB/Redis 后运行本机开发服务器（Next dev，端口 13500）：
  - `make dev`
- 本地构建并启动 Docker app（默认端口 23000）：
  - `make app`

如果你希望手动运行（不通过 `make dev`）：

- 先启动 DB/Redis：`make db`
- 再启动开发服务器：
  - `DSN=postgres://postgres:postgres@127.0.0.1:5432/claude_code_hub REDIS_URL=redis://127.0.0.1:6379 ENABLE_RATE_LIMIT=true bun run dev`

## 关于“旧镜像残留”

- `make app` 使用固定标签 `claude-code-hub-local:${APP_VERSION}`，每次 `--build` 会把标签指向新镜像；旧镜像会变成 dangling（不影响运行，但会占用磁盘）。
- 常用处理：
  - 强制重建并重建容器：`make app-rebuild`
  - 无缓存重建：`make app-nocache`
  - 清理 dangling 镜像：`make prune-images`

## 常用命令

- 查看容器状态：`make status`
- 查看日志：`make logs` / `make logs-app` / `make logs-db` / `make logs-redis`
- 进入数据库：`make db-shell`
- 进入 Redis：`make redis-shell`
- 停止服务：`make stop`
- 清理容器（保留数据）：`make clean`
- 重置环境（删除数据）：`make reset`

## 变量覆盖

可通过环境变量覆盖端口与账号（示例）：

- `POSTGRES_PORT=35432 REDIS_PORT=36379 make db`
- `APP_PORT=24000 make app`
- `DB_PASSWORD=postgres make dev`
