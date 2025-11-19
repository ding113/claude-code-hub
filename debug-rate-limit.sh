#!/bin/bash
# 日限额功能排查脚本

echo "=========================================="
echo "日限额功能排查工具"
echo "=========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. 检查环境变量
echo "1. 检查环境变量配置"
echo "----------------------------------------"
if [ -f .env ]; then
    echo "✓ .env 文件存在"

    ENABLE_RATE_LIMIT=$(grep "ENABLE_RATE_LIMIT" .env | cut -d '=' -f2)
    REDIS_URL=$(grep "REDIS_URL" .env | cut -d '=' -f2)

    if [ "$ENABLE_RATE_LIMIT" = "true" ]; then
        echo -e "${GREEN}✓ ENABLE_RATE_LIMIT=true${NC}"
    else
        echo -e "${RED}✗ ENABLE_RATE_LIMIT=$ENABLE_RATE_LIMIT (应该是 true)${NC}"
    fi

    if [ -n "$REDIS_URL" ]; then
        echo -e "${GREEN}✓ REDIS_URL=$REDIS_URL${NC}"
    else
        echo -e "${RED}✗ REDIS_URL 未配置${NC}"
    fi
else
    echo -e "${RED}✗ .env 文件不存在${NC}"
fi
echo ""

# 2. 检查 Redis 连接
echo "2. 检查 Redis 连接"
echo "----------------------------------------"
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo -e "${GREEN}✓ Redis 连接正常${NC}"

        # 检查 Redis 中的限流 key
        echo ""
        echo "Redis 中的限流相关 key："
        redis-cli --scan --pattern "ratelimit:*" | head -10
    else
        echo -e "${RED}✗ Redis 连接失败${NC}"
    fi
else
    echo -e "${YELLOW}⚠ redis-cli 未安装，跳过 Redis 检查${NC}"
fi
echo ""

# 3. 检查数据库配置
echo "3. 检查数据库中的供应商限额配置"
echo "----------------------------------------"
if [ -n "$DSN" ]; then
    psql "$DSN" -c "
    SELECT
      id,
      name,
      is_enabled,
      limit_daily_usd,
      daily_reset_mode,
      daily_reset_time,
      provider_type
    FROM providers
    WHERE deleted_at IS NULL
      AND limit_daily_usd IS NOT NULL
    ORDER BY id;
    " 2>/dev/null || echo -e "${RED}✗ 数据库连接失败${NC}"
else
    echo -e "${YELLOW}⚠ DSN 环境变量未设置，请手动运行：${NC}"
    echo "psql \$DSN -c \"SELECT id, name, limit_daily_usd, daily_reset_mode, daily_reset_time FROM providers WHERE deleted_at IS NULL AND limit_daily_usd IS NOT NULL;\""
fi
echo ""

# 4. 检查最近的消息请求日志
echo "4. 检查最近的消息请求（最近 10 条）"
echo "----------------------------------------"
if [ -n "$DSN" ]; then
    psql "$DSN" -c "
    SELECT
      id,
      provider_id,
      cost_usd,
      created_at,
      model
    FROM message_request
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 10;
    " 2>/dev/null || echo -e "${RED}✗ 数据库连接失败${NC}"
else
    echo -e "${YELLOW}⚠ 请手动查询最近的消息请求${NC}"
fi
echo ""

# 5. 提供手动检查 Redis 的命令
echo "5. 手动检查 Redis 数据的命令"
echo "----------------------------------------"
echo "查看特定供应商的日消费："
echo "  redis-cli GET \"ratelimit:provider:<PROVIDER_ID>:daily:<YYYY-MM-DD>\""
echo ""
echo "查看所有限流 key："
echo "  redis-cli --scan --pattern \"ratelimit:*\""
echo ""
echo "查看特定 key 的值和 TTL："
echo "  redis-cli GET \"ratelimit:provider:1:daily:2025-01-19\""
echo "  redis-cli TTL \"ratelimit:provider:1:daily:2025-01-19\""
echo ""

# 6. 检查应用日志
echo "6. 检查应用日志"
echo "----------------------------------------"
echo "请查看应用日志中的限流相关信息："
echo "  grep -i \"rate.*limit\\|quota\\|exceeded\" logs/*.log"
echo ""
echo "或者实时监控："
echo "  tail -f logs/*.log | grep -i \"rate.*limit\\|quota\""
echo ""

echo "=========================================="
echo "排查完成"
echo "=========================================="
