# syntax=docker/dockerfile:1

# 阶段 1: 安装依赖
FROM oven/bun:debian AS deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# 阶段 2: 构建应用
FROM oven/bun:debian AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 设置构建时环境变量（避免数据库连接检查失败）
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true
ENV DSN="postgres://placeholder:placeholder@localhost:5432/placeholder"
ENV REDIS_URL="redis://localhost:6379"

RUN bun run build

# 阶段 3: 运行镜像
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=7860
ENV HOSTNAME="0.0.0.0"

# Hugging Face 默认使用 7860 端口
EXPOSE 7860

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# 启动脚本
CMD ["node", "node_modules/.bin/next", "start"]
