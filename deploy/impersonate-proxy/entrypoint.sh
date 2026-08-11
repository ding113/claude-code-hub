#!/bin/sh
# CCH entrypoint: 先起本地伪装代理(curl_cffi 连接池),再起 node server.js。
# 代理不可用时 node 仍启动(伪装走 fallback: spawn curl 子进程)。

set -e

IMPERSONATE_PROXY_PORT="${IMPERSONATE_PROXY_PORT:-18686}"

# 启动本地伪装代理
python3 /app/impersonate_proxy.py &
PROXY_PID=$!
echo "[entrypoint] impersonate proxy started (pid=$PROXY_PID, port=$IMPERSONATE_PROXY_PORT)"

# 等待代理健康(最多 15s);容器无 curl,用 node fetch
PROXY_OK=0
i=0
while [ $i -lt 30 ]; do
  if node -e "fetch('http://127.0.0.1:${IMPERSONATE_PROXY_PORT}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    PROXY_OK=1
    break
  fi
  i=$((i + 1))
  sleep 0.5
done
if [ "$PROXY_OK" = "1" ]; then
  echo "[entrypoint] impersonate proxy healthy"
else
  echo "[entrypoint] WARNING: impersonate proxy not healthy after 15s, continuing without it (fallback to spawn curl)"
  kill $PROXY_PID 2>/dev/null || true
fi

# 起 node(原 CMD)
exec node --report-on-fatalerror --report-uncaught-exception \
  --report-directory=/app/reports server.js
