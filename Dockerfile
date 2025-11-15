# syntax=docker/dockerfile:1
# Claude Code Hub - Production Dockerfile
# 用于手动构建部署，无需预构建镜像

FROM --platform=$BUILDPLATFORM oven/bun:1.2.27 AS base
WORKDIR /app

# 安装依赖
FROM base AS deps
COPY package.json bun.lockb ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --production

# 构建应用
FROM base AS builder
COPY package.json bun.lockb ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

COPY . .

# 接收构建参数
ARG APP_VERSION=dev
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION

RUN bun run build

# 生产运行时
FROM oven/bun:1.2.27-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# 安装 PostgreSQL 客户端工具和 curl
RUN apt-get update && \
    apt-get install -y gnupg curl ca-certificates postgresql-client && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y postgresql-client-18 && \
    rm -rf /var/lib/apt/lists/*

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 bun

# 复制构建产物
COPY --from=builder --chown=bun:nodejs /app/public ./public
COPY --from=builder --chown=bun:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=bun:nodejs /app/messages ./messages
COPY --from=builder --chown=bun:nodejs /app/.next/standalone ./
COPY --from=builder --chown=bun:nodejs /app/.next/server ./.next/server
COPY --from=builder --chown=bun:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=bun:nodejs /app/package.json ./package.json

USER bun

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["bun", "run", "start"]