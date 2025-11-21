/**
 * Redis Lua 脚本集合
 *
 * 用于保证 Redis 操作的原子性
 */

/**
 * 原子性检查并发限制 + 追踪 Session（TC-041 修复版）
 *
 * 功能：
 * 1. 清理过期 session（5 分钟前）
 * 2. 检查 session 是否已追踪（避免重复计数）
 * 3. 检查当前并发数是否超限
 * 4. 如果未超限，追踪新 session（原子操作）
 *
 * KEYS[1]: provider:${providerId}:active_sessions
 * ARGV[1]: sessionId
 * ARGV[2]: limit（并发限制）
 * ARGV[3]: now（当前时间戳，毫秒）
 *
 * 返回值：
 * - {1, count, 1} - 允许（新追踪），返回新的并发数和 tracked=1
 * - {1, count, 0} - 允许（已追踪），返回当前并发数和 tracked=0
 * - {0, count, 0} - 拒绝（超限），返回当前并发数和 tracked=0
 */
export const CHECK_AND_TRACK_SESSION = `
local provider_key = KEYS[1]
local session_id = ARGV[1]
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = 300000  -- 5 分钟（毫秒）

-- 1. 清理过期 session（5 分钟前）
local five_minutes_ago = now - ttl
redis.call('ZREMRANGEBYSCORE', provider_key, '-inf', five_minutes_ago)

-- 2. 检查 session 是否已追踪
local is_tracked = redis.call('ZSCORE', provider_key, session_id)

-- 3. 获取当前并发数
local current_count = redis.call('ZCARD', provider_key)

-- 4. 检查限制（排除已追踪的 session）
if limit > 0 and not is_tracked and current_count >= limit then
  return {0, current_count, 0}  -- {allowed=false, current_count, tracked=0}
end

-- 5. 追踪 session（ZADD 对已存在的成员只更新时间戳）
redis.call('ZADD', provider_key, now, session_id)
redis.call('EXPIRE', provider_key, 3600)  -- 1 小时兜底 TTL

-- 6. 返回成功
if is_tracked then
  -- 已追踪，计数不变
  return {1, current_count, 0}  -- {allowed=true, count, tracked=0}
else
  -- 新追踪，计数 +1
  return {1, current_count + 1, 1}  -- {allowed=true, new_count, tracked=1}
end
`;

/**
 * 批量检查多个供应商的并发限制
 *
 * KEYS: provider:${providerId}:active_sessions (多个)
 * ARGV[1]: sessionId
 * ARGV[2...]: limits（每个供应商的并发限制）
 * ARGV[N]: now（当前时间戳，毫秒）
 *
 * 返回值：数组，每个元素对应一个供应商
 * - {1, count} - 允许
 * - {0, count} - 拒绝（超限）
 */
export const BATCH_CHECK_SESSION_LIMITS = `
local session_id = ARGV[1]
local now = tonumber(ARGV[#ARGV])
local ttl = 300000  -- 5 分钟（毫秒）
local five_minutes_ago = now - ttl

local results = {}

-- 遍历所有供应商 key
for i = 1, #KEYS do
  local provider_key = KEYS[i]
  local limit = tonumber(ARGV[i + 1])  -- ARGV[2]...ARGV[N-1]

  -- 清理过期 session
  redis.call('ZREMRANGEBYSCORE', provider_key, '-inf', five_minutes_ago)

  -- 获取当前并发数
  local current_count = redis.call('ZCARD', provider_key)

  -- 检查限制
  if limit > 0 and current_count >= limit then
    table.insert(results, {0, current_count})  -- 拒绝
  else
    table.insert(results, {1, current_count})  -- 允许
  end
end

return results
`;

/**
 * 追踪 5小时滚动窗口消费（使用 ZSET）
 *
 * 功能：
 * 1. 清理 5 小时前的消费记录
 * 2. 添加当前消费记录（带时间戳）
 * 3. 计算当前窗口内的总消费
 * 4. 设置兜底 TTL（6 小时）
 *
 * KEYS[1]: key:${id}:cost_5h_rolling 或 provider:${id}:cost_5h_rolling
 * ARGV[1]: cost（本次消费金额）
 * ARGV[2]: now（当前时间戳，毫秒）
 * ARGV[3]: window（窗口时长，毫秒，默认 18000000 = 5小时）
 *
 * 返回值：string - 当前窗口内的总消费
 */
export const TRACK_COST_5H_ROLLING_WINDOW = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local now_ms = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])  -- 5 hours = 18000000 ms

-- 1. 清理过期记录（5 小时前的数据）
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. 添加当前消费记录（member = timestamp:cost，便于调试和追踪）
local member = now_ms .. ':' .. cost
redis.call('ZADD', key, now_ms, member)

-- 3. 计算窗口内总消费
local records = redis.call('ZRANGE', key, 0, -1)
local total = 0
for _, record in ipairs(records) do
  -- 解析 member 格式："timestamp:cost"
  local cost_str = string.match(record, ':(.+)')
  if cost_str then
    total = total + tonumber(cost_str)
  end
end

-- 4. 设置兜底 TTL（6 小时，防止数据永久堆积）
redis.call('EXPIRE', key, 21600)

return tostring(total)
`;

/**
 * 查询 5小时滚动窗口当前消费
 *
 * 功能：
 * 1. 清理 5 小时前的消费记录
 * 2. 计算当前窗口内的总消费
 *
 * KEYS[1]: key:${id}:cost_5h_rolling 或 provider:${id}:cost_5h_rolling
 * ARGV[1]: now（当前时间戳，毫秒）
 * ARGV[2]: window（窗口时长，毫秒，默认 18000000 = 5小时）
 *
 * 返回值：string - 当前窗口内的总消费
 */
export const GET_COST_5H_ROLLING_WINDOW = `
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])  -- 5 hours = 18000000 ms

-- 1. 清理过期记录
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. 计算窗口内总消费
local records = redis.call('ZRANGE', key, 0, -1)
local total = 0
for _, record in ipairs(records) do
  local cost_str = string.match(record, ':(.+)')
  if cost_str then
    total = total + tonumber(cost_str)
  end
end

return tostring(total)
`;

/**
 * 追踪 24小时滚动窗口消费（使用 ZSET）
 *
 * 功能：
 * 1. 清理 24 小时前的消费记录
 * 2. 添加当前消费记录（带时间戳）
 * 3. 计算当前窗口内的总消费
 * 4. 设置兜底 TTL（25 小时）
 *
 * KEYS[1]: key:${id}:cost_daily_rolling 或 provider:${id}:cost_daily_rolling
 * ARGV[1]: cost（本次消费金额）
 * ARGV[2]: now（当前时间戳，毫秒）
 * ARGV[3]: window（窗口时长，毫秒，默认 86400000 = 24小时）
 *
 * 返回值：string - 当前窗口内的总消费
 */
export const TRACK_COST_DAILY_ROLLING_WINDOW = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local now_ms = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])  -- 24 hours = 86400000 ms

-- 1. 清理过期记录（24 小时前的数据）
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. 添加当前消费记录（member = timestamp:cost，便于调试和追踪）
local member = now_ms .. ':' .. cost
redis.call('ZADD', key, now_ms, member)

-- 3. 计算窗口内总消费
local records = redis.call('ZRANGE', key, 0, -1)
local total = 0
for _, record in ipairs(records) do
  -- 解析 member 格式："timestamp:cost"
  local cost_str = string.match(record, ':(.+)')
  if cost_str then
    total = total + tonumber(cost_str)
  end
end

-- 4. 设置兜底 TTL（25 小时，防止数据永久堆积）
redis.call('EXPIRE', key, 90000)

return tostring(total)
`;

/**
 * 查询 24小时滚动窗口当前消费
 *
 * 功能：
 * 1. 清理 24 小时前的消费记录
 * 2. 计算当前窗口内的总消费
 *
 * KEYS[1]: key:${id}:cost_daily_rolling 或 provider:${id}:cost_daily_rolling
 * ARGV[1]: now（当前时间戳，毫秒）
 * ARGV[2]: window（窗口时长，毫秒，默认 86400000 = 24小时）
 *
 * 返回值：string - 当前窗口内的总消费
 */
export const GET_COST_DAILY_ROLLING_WINDOW = `
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])  -- 24 hours = 86400000 ms

-- 1. 清理过期记录
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. 计算窗口内总消费
local records = redis.call('ZRANGE', key, 0, -1)
local total = 0
for _, record in ipairs(records) do
  local cost_str = string.match(record, ':(.+)')
  if cost_str then
    total = total + tonumber(cost_str)
  end
end

return tostring(total)
`;
