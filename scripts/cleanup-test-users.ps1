# 清理测试用户脚本（PowerShell 版本）

Write-Host "🔍 检查测试用户数量..." -ForegroundColor Cyan

# 统计测试用户
docker exec claude-code-hub-db-dev psql -U postgres -d claude_code_hub -c @"
SELECT COUNT(*) as 测试用户数量
FROM users
WHERE (name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%')
  AND deleted_at IS NULL;
"@

Write-Host ""
Write-Host "📋 预览将要删除的用户（前 10 个）..." -ForegroundColor Cyan
docker exec claude-code-hub-db-dev psql -U postgres -d claude_code_hub -c @"
SELECT id, name, created_at
FROM users
WHERE (name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%')
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 10;
"@

Write-Host ""
$confirm = Read-Host "⚠️  确认删除这些测试用户吗？(y/N)"

if ($confirm -eq 'y' -or $confirm -eq 'Y') {
    Write-Host "🗑️  开始清理..." -ForegroundColor Yellow

    # 软删除关联的 keys
    docker exec claude-code-hub-db-dev psql -U postgres -d claude_code_hub -c @"
    UPDATE keys
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE user_id IN (
      SELECT id FROM users
      WHERE (name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%')
        AND deleted_at IS NULL
    )
    AND deleted_at IS NULL;
"@

    # 软删除测试用户
    $result = docker exec claude-code-hub-db-dev psql -U postgres -d claude_code_hub -c @"
    UPDATE users
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE (name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%')
      AND deleted_at IS NULL
    RETURNING id, name;
"@

    Write-Host "✅ 清理完成！" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 剩余用户统计：" -ForegroundColor Cyan
    docker exec claude-code-hub-db-dev psql -U postgres -d claude_code_hub -c @"
    SELECT COUNT(*) as 总用户数 FROM users WHERE deleted_at IS NULL;
"@
} else {
    Write-Host "❌ 取消清理" -ForegroundColor Red
}
