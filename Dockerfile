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

# impersonate-proxy: 需要 python3 运行常驻伪装代理(全局 curl_multi + 连接复用)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*

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

# impersonate-proxy: 常驻伪装转发代理(gcc9 官方构建的 libcurl-impersonate-chrome .so
# + curl_easy_impersonate API,与 CLI 二进制同速;curl_multi 驱动,连接复用 keep-alive)
COPY deploy/impersonate-proxy/impersonate_proxy.py /app/impersonate_proxy.py
COPY deploy/impersonate-proxy/libcurl-impersonate-chrome.so.4.8.0 /usr/local/lib/libcurl-impersonate-chrome.so.4.8.0
COPY deploy/impersonate-proxy/libcurl-impersonate-chrome.so.4 /usr/local/lib/libcurl-impersonate-chrome.so.4
COPY deploy/impersonate-proxy/libcurl-impersonate-chrome.so /usr/local/lib/libcurl-impersonate-chrome.so
RUN ldconfig

# --report-on-fatalerror / --report-uncaught-exception：在 native 段错误或
# 未捕获异常时写出 JSON 诊断报告（包含原生堆栈、libuv 句柄、JS 堆等）
# --report-directory：指向 /app/reports 以便挂卷持久化
# 先后台启动 impersonate-proxy(127.0.0.1:18686),再 exec 主服务,保证 node 收到信号
CMD ["sh", "-c", "python3 /app/impersonate_proxy.py & exec node --report-on-fatalerror --report-uncaught-exception --report-directory=/app/reports server.js"]
