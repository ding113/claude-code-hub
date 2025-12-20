# syntax=docker/dockerfile:1

# 构建阶段：使用 Bun（快速包管理和构建）
FROM --platform=$BUILDPLATFORM oven/bun:debian AS build-base
WORKDIR /app

FROM build-base AS deps
COPY package.json ./
RUN bun install

FROM deps AS build
COPY . .

# 接收构建参数
ARG APP_VERSION=dev

# 设置为环境变量供 Next.js 使用
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION

# 构建时需要的环境变量 (避免数据库初始化错误)
# 这些是占位符,实际运行时会被真实值覆盖
ENV DSN="postgres://placeholder:placeholder@localhost:5432/placeholder"
ENV REDIS_URL="redis://localhost:6379"
# 标记为 CI 环境，跳过 instrumentation.ts 中的数据库连接
ENV CI=true

RUN bun run build

# 运行阶段：使用 Node.js（避免 Bun 流式响应内存泄漏 Issue #18488）
FROM node:trixie-slim AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
WORKDIR /app

# 安装 PostgreSQL 18 客户端工具（用于数据库备份/恢复功能）和 curl（用于健康检查）
# node:trixie-slim 基于 Debian Trixie，默认只有 PostgreSQL 17.x
# 使用 PostgreSQL 官方仓库安装 18.x 以匹配 docker-compose 中的 postgres:18
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/pgdg.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client-18 && \
    apt-get purge -y --auto-remove gnupg && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/messages ./messages
COPY --from=build --chown=node:node /app/.next/standalone ./
# Server Actions live inside .next/server; copy it or Next.js cannot resolve action IDs.
COPY --from=build --chown=node:node /app/.next/server ./.next/server
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

CMD ["node", "server.js"]
