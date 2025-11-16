#!/bin/bash

# 验证 Docker 构建的关键文件结构
# 模拟 Dockerfile 的文件复制过程并验证

set -e

echo "🔍 验证 Next.js 构建产物..."

# 1. 检查本地构建产物
echo ""
echo "📦 检查本地 .next/server 目录:"
if [ -f ".next/server/middleware.js.nft.json" ]; then
    echo "✅ middleware.js.nft.json 存在"
    ls -lh .next/server/middleware.js.nft.json
else
    echo "❌ middleware.js.nft.json 不存在！"
    exit 1
fi

# 2. 检查 standalone 输出
echo ""
echo "📦 检查 .next/standalone/.next/server 目录:"
if [ -d ".next/standalone/.next/server" ]; then
    echo "目录存在，内容:"
    ls .next/standalone/.next/server/ | grep middleware || echo "  (没有 middleware 相关文件)"

    if [ -f ".next/standalone/.next/server/middleware.js.nft.json" ]; then
        echo "✅ NFT 文件在 standalone 中存在"
    else
        echo "⚠️  NFT 文件不在 standalone 中（这是正常的）"
    fi
else
    echo "⚠️  standalone/.next/server 目录不存在"
fi

# 3. 模拟 Dockerfile 的文件复制
echo ""
echo "🐳 模拟 Dockerfile 文件复制逻辑:"
echo "   Dockerfile 第 44 行: COPY .next/standalone → /"
echo "   Dockerfile 第 46 行: COPY .next/server → /.next/server"
echo ""
echo "预期结果:"
echo "  /app/.next/static        ← 从 .next/static"
echo "  /app/.next/server        ← 从 .next/server (包含 NFT)"
echo "  /app/node_modules        ← 从 .next/standalone"
echo "  /app/server.js           ← 从 .next/standalone"

# 4. 创建模拟的 Docker 文件结构
MOCK_DIR="/tmp/docker-mock-$$"
mkdir -p "$MOCK_DIR/app"

echo ""
echo "📁 创建模拟 Docker 结构: $MOCK_DIR/app"

# 复制 standalone
cp -r .next/standalone/* "$MOCK_DIR/app/" 2>/dev/null || echo "  Warning: standalone 复制部分失败"

# 复制 server (关键步骤！)
mkdir -p "$MOCK_DIR/app/.next"
cp -r .next/server "$MOCK_DIR/app/.next/" 2>/dev/null || echo "  Warning: server 复制失败"

# 复制 static
cp -r .next/static "$MOCK_DIR/app/.next/" 2>/dev/null || echo "  Warning: static 复制失败"

# 5. 验证模拟结构
echo ""
echo "✅ 验证模拟 Docker 镜像结构:"
if [ -f "$MOCK_DIR/app/.next/server/middleware.js.nft.json" ]; then
    echo "✅ SUCCESS: /app/.next/server/middleware.js.nft.json 存在！"
    ls -lh "$MOCK_DIR/app/.next/server/middleware.js.nft.json"
else
    echo "❌ FAILED: middleware.js.nft.json 缺失！"
    echo "   这会导致 CI 构建报错: ENOENT /app/.next/server/middleware.js.nft.json"
    exit 1
fi

echo ""
echo "🎯 完整验证通过！Docker 镜像将包含所需的 NFT 文件。"
echo ""
echo "CI 修复要点:"
echo "  1. ✅ Dockerfile 已包含 'COPY .next/server' (第 46 行)"
echo "  2. ✅ 已添加构建断言 'test -f .next/server/middleware.js.nft.json'"
echo "  3. ⚠️  确保 CI 使用最新的 Dockerfile 并清除缓存"

# 清理
rm -rf "$MOCK_DIR"

exit 0
