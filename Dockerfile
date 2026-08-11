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
RUN --mount=type=cache,target=/app/.next/cache bun run build

FROM node:22-slim AS runner
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

# Node 诊断报告输出目录（issue #1147）
# 容器外通过 docker-compose volume 挂载到 ./data/reports 持久化
RUN mkdir -p /app/reports

# curl-impersonate: 模拟 Chrome TLS 指纹,绕过上游 Cloudflare 对非浏览器客户端的
# 风控拦截(sub2api 同步 403 问题)。curl_chrome116 是 wrapper 脚本,需要主二进制同目录。
COPY deploy/curl-impersonate/curl_chrome116 /usr/local/bin/curl_chrome116
COPY deploy/curl-impersonate/curl-impersonate-chrome /usr/local/bin/curl-impersonate-chrome
COPY deploy/curl-impersonate/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN chmod +x /usr/local/bin/curl_chrome116 /usr/local/bin/curl-impersonate-chrome \
  && ln -sf /usr/local/bin/curl_chrome116 /usr/local/bin/curl_chrome \
  && curl_chrome --version 2>/dev/null | head -1 || true

# --report-on-fatalerror / --report-uncaught-exception：在 native 段错误或
# 未捕获异常时写出 JSON 诊断报告（包含原生堆栈、libuv 句柄、JS 堆等）
# --report-directory：指向 /app/reports 以便挂卷持久化
CMD ["node", "--report-on-fatalerror", "--report-uncaught-exception", "--report-directory=/app/reports", "server.js"]
