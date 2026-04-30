# syntax=docker/dockerfile:1
FROM oven/bun:debian AS deps
WORKDIR /app
COPY package.json ./
RUN bun install

FROM oven/bun:debian AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true

# 构建时需要的环境变量占位符（避免数据库初始化错误）
ENV DSN="postgres://placeholder:placeholder@localhost:5432/placeholder"
ENV REDIS_URL="redis://localhost:6379"
ENV DB_POOL_MAX="10"
ENV DB_POOL_IDLE_TIMEOUT="20"
ENV DB_POOL_CONNECT_TIMEOUT="10"
ENV MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS="250"
ENV MESSAGE_REQUEST_ASYNC_BATCH_SIZE="200"
ENV MESSAGE_REQUEST_ASYNC_MAX_PENDING="5000"
ENV ADMIN_TOKEN="ci-build-placeholder"

RUN --mount=type=cache,target=/app/.next/cache bun run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 关键：确保复制了所有必要的文件，特别是 drizzle 文件夹
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/VERSION ./VERSION

CMD ["node", "server.js"]
