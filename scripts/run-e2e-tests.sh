#!/bin/bash
# E2E 测试运行脚本
#
# 功能：
# 1. 启动 Next.js 开发服务器
# 2. 等待服务器就绪
# 3. 运行 E2E 测试
# 4. 清理并停止服务器
#
# 使用方法：
#   bash scripts/run-e2e-tests.sh

set -e  # 遇到错误立即退出

echo "E2E 测试运行脚本"
echo "===================="
echo ""

# ==================== 1. 检查数据库连接 ====================

COMPOSE_FILE="docker-compose.dev.yaml"

echo "检查数据库连接..."
if [ -n "$(docker compose -f "$COMPOSE_FILE" ps -q --status running postgres 2>/dev/null)" ]; then
  echo "PostgreSQL 已运行"
else
  echo "PostgreSQL 未运行，正在启动..."
  docker compose -f "$COMPOSE_FILE" up -d postgres redis
  echo "等待数据库启动..."
  sleep 5
fi

echo ""

# ==================== 2. 启动开发服务器 ====================

echo "启动 Next.js 开发服务器..."

# 后台启动服务器
PORT=13500 bun run dev > /tmp/nextjs-dev.log 2>&1 &
SERVER_PID=$!

echo "服务器 PID: $SERVER_PID"
echo "等待服务器就绪..."

# 等待服务器启动（最多等待 60 秒）
TIMEOUT=60
COUNTER=0

while [ $COUNTER -lt $TIMEOUT ]; do
  if curl -s http://localhost:13500/api/actions/health > /dev/null 2>&1; then
    echo "服务器已就绪"
    break
  fi

  COUNTER=$((COUNTER + 1))
  sleep 1
  echo -n "."
done

if [ $COUNTER -eq $TIMEOUT ]; then
  echo ""
  echo "服务器启动超时"
  kill $SERVER_PID 2>/dev/null || true
  exit 1
fi

echo ""

# ==================== 3. 运行 E2E 测试 ====================

echo "运行 E2E 测试..."
echo ""

# 设置环境变量
export API_BASE_URL="http://localhost:13500/api/actions"
export AUTO_CLEANUP_TEST_DATA=true

# 运行 E2E 测试
bun run test tests/e2e/

TEST_EXIT_CODE=$?

echo ""

# ==================== 4. 清理并停止服务器 ====================

echo "停止开发服务器..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo "服务器已停止"
echo ""

# ==================== 5. 输出测试结果 ====================

if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "E2E 测试全部通过"
  exit 0
else
  echo "E2E 测试失败"
  exit $TEST_EXIT_CODE
fi
