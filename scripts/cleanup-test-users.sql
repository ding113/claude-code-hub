-- 清理测试用户脚本
-- 删除所有包含"测试用户"、"test"或"Test"的用户及其关联数据

BEGIN;

-- 1. 统计将要删除的用户
SELECT
  COUNT(*) as 将要删除的用户数,
  STRING_AGG(DISTINCT name, ', ') as 示例用户名
FROM users
WHERE (name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%')
  AND deleted_at IS NULL;

-- 2. 删除关联的 keys（软删除）
UPDATE keys
SET deleted_at = NOW(), updated_at = NOW()
WHERE user_id IN (
  SELECT id FROM users
  WHERE (name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%')
    AND deleted_at IS NULL
)
AND deleted_at IS NULL;

-- 3. 删除用户（软删除）
UPDATE users
SET deleted_at = NOW(), updated_at = NOW()
WHERE (name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%')
  AND deleted_at IS NULL;

-- 4. 查看删除结果
SELECT
  COUNT(*) as 剩余用户总数,
  COUNT(*) FILTER (WHERE name LIKE '测试用户%' OR name LIKE '%test%' OR name LIKE 'Test%') as 剩余测试用户
FROM users
WHERE deleted_at IS NULL;

-- 如果确认无误，执行 COMMIT；否则执行 ROLLBACK
-- COMMIT;
ROLLBACK;
