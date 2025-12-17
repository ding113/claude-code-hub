#!/bin/bash
# 清理测试用户脚本

echo "🔍 检查测试用户数量..."

# 统计测试用户
docker exec claude-code-hub-db-dev psql -U postgres -d claude_code_hub -c "
SELECT
  COUNT(*) as 测试用户数量
FROM users
WHERE (name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%')
  AND deleted_at IS NULL;
"

echo ""
echo "📋 预览将要删除的用户（前 10 个）..."
docker exec claude-code-hub-db-dev psql -U postgres -d claude_code_hub -c "
SELECT id, name, created_at
FROM users
WHERE (name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%')
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 10;
"

echo ""
read -p "⚠️  确认删除这些测试用户吗？(y/N): " confirm

if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
  echo "🗑️  开始清理..."

  # 软删除关联的 keys
  docker exec claude-code-hub-db-dev psql -U postgres -d claude_code_hub -c "
  UPDATE keys
  SET deleted_at = NOW(), updated_at = NOW()
  WHERE user_id IN (
    SELECT id FROM users
    WHERE (name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%')
      AND deleted_at IS NULL
  )
  AND deleted_at IS NULL;
  "

  # 软删除测试用户
  docker exec claude-code-hub-db-dev psql -U postgres -d claude_code_hub -c "
  UPDATE users
  SET deleted_at = NOW(), updated_at = NOW()
  WHERE (name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%')
    AND deleted_at IS NULL;
  "

  echo "✅ 清理完成！"
  echo ""
  echo "📊 剩余用户统计："
  docker exec claude-code-hub-db-dev psql -U postgres -d claude_code_hub -c "
  SELECT COUNT(*) as 总用户数 FROM users WHERE deleted_at IS NULL;
  "
else
  echo "❌ 取消清理"
fi
