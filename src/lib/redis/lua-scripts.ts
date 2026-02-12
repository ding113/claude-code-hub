/**
 * Redis Lua 脚本集合
 *
 * 用于保证 Redis 操作的原子性
 */

/**
 * Atomic concurrency check + session tracking (TC-041 fixed version)
 *
 * Features:
 * 1. Cleanup expired sessions (based on TTL window)
 * 2. Check if session is already tracked (avoid duplicate counting)
 * 3. Check if current concurrency exceeds limit
 * 4. If not exceeded, track new session (atomic operation)
 *
 * KEYS[1]: provider:${providerId}:active_sessions
 * ARGV[1]: sessionId
 * ARGV[2]: limit (concurrency limit)
 * ARGV[3]: now (current timestamp, ms)
 * ARGV[4]: ttlMs (optional, cleanup window in ms, default 300000)
 *
 * Return:
 * - {1, count, 1} - allowed (new tracking), returns new count and tracked=1
 * - {1, count, 0} - allowed (already tracked), returns current count and tracked=0
 * - {0, count, 0} - rejected (limit reached), returns current count and tracked=0
 */
export const CHECK_AND_TRACK_SESSION = `
local provider_key = KEYS[1]
local session_id = ARGV[1]
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4]) or 300000

-- Guard against invalid TTL (prevents clearing all sessions)
if ttl <= 0 then
  ttl = 300000
end

-- 1. Cleanup expired sessions (TTL window ago)
local cutoff = now - ttl
redis.call('ZREMRANGEBYSCORE', provider_key, '-inf', cutoff)

-- 2. Check if session is already tracked
local is_tracked = redis.call('ZSCORE', provider_key, session_id)

-- 3. Get current concurrency count
local current_count = redis.call('ZCARD', provider_key)

-- 4. Check limit (exclude already tracked session)
if limit > 0 and not is_tracked and current_count >= limit then
  return {0, current_count, 0}  -- {allowed=false, current_count, tracked=0}
end

-- 5. Track session (ZADD updates timestamp for existing members)
redis.call('ZADD', provider_key, now, session_id)

-- 6. Set TTL based on session TTL (at least 1h to cover active sessions)
local ttl_seconds = math.floor(ttl / 1000)
local expire_ttl = math.max(3600, ttl_seconds)
redis.call('EXPIRE', provider_key, expire_ttl)

-- 7. Return success
if is_tracked then
  -- Already tracked, count unchanged
  return {1, current_count, 0}  -- {allowed=true, count, tracked=0}
else
  -- New tracking, count +1
  return {1, current_count + 1, 1}  -- {allowed=true, new_count, tracked=1}
end
`;

/**
 * Key/User 并发：原子性检查 + 追踪（修复竞态条件）
 *
 * 目标：
 * - 解决 key/user 并发检查与追踪分离导致的竞态条件（可能短时间超过用户并发上限）
 * - 允许已存在的 session 在达到上限时继续请求（仅阻止“新 session”进入）
 *
 * 注意：
 * - global 仅用于观测（Sessions 页面），不参与并发判断；但当启用并发上限时，SessionGuard 会跳过
 *   SessionTracker.trackSession，因此此脚本也负责更新 global，保证 Sessions 页面可见性。
 * - key/user 使用 ZSET 分别追踪活跃 sessionId（score=timestamp）
 *
 * KEYS[1]: global:active_sessions
 * KEYS[2]: key:${keyId}:active_sessions
 * KEYS[3]: user:${userId}:active_sessions
 * ARGV[1]: sessionId
 * ARGV[2]: keyLimit
 * ARGV[3]: userLimit
 * ARGV[4]: now（毫秒时间戳）
 * ARGV[5]: ttlMs（可选，清理窗口，默认 300000ms）
 *
 * Return: {allowed, rejectedBy, keyCount, keyTracked, userCount, userTracked}
 * - allowed=1: 放行
 * - allowed=0: 拒绝（rejectedBy=1 表示 Key 超限，=2 表示 User 超限）
 * - key/user Count：返回“最终计数”（若未追踪则为当前计数）
 * - key/user Tracked：1 表示本次为新追踪，0 表示已存在
 */
export const CHECK_AND_TRACK_KEY_USER_SESSION = `
local global_key = KEYS[1]
local key_key = KEYS[2]
local user_key = KEYS[3]

local session_id = ARGV[1]
local key_limit = tonumber(ARGV[2])
local user_limit = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5]) or 300000

-- Guard against invalid TTL (prevents clearing all sessions)
if ttl <= 0 then
  ttl = 300000
end

 -- 1. Cleanup expired sessions (TTL window ago)
 local cutoff = now - ttl
 redis.call('ZREMRANGEBYSCORE', global_key, '-inf', cutoff)
 redis.call('ZREMRANGEBYSCORE', key_key, '-inf', cutoff)
 redis.call('ZREMRANGEBYSCORE', user_key, '-inf', cutoff)

-- 2. Check if session is already tracked
local is_tracked_key = redis.call('ZSCORE', key_key, session_id)
local is_tracked_user = redis.call('ZSCORE', user_key, session_id)

-- 3. Get current concurrency counts
local current_key_count = redis.call('ZCARD', key_key)
local current_user_count = redis.call('ZCARD', user_key)

-- 4. Check Key limit (exclude already tracked session)
if key_limit > 0 and not is_tracked_key and current_key_count >= key_limit then
  return {0, 1, current_key_count, 0, current_user_count, 0}
end

 -- 5. Check User limit (exclude already tracked session)
 -- Self-heal: 如果 session 已在同一个 key 的集合中，则可视为该 user 的“已存在会话”，避免因为 user 集合缺失
 -- 单条 member 而误拦截（该脚本后续会通过 ZADD 补齐 user 集合）。
if user_limit > 0 and not (is_tracked_user or is_tracked_key) and current_user_count >= user_limit then
  return {0, 2, current_key_count, 0, current_user_count, 0}
end

-- 6. Track session (ZADD updates timestamp for existing members)
redis.call('ZADD', global_key, now, session_id)
redis.call('ZADD', key_key, now, session_id)
redis.call('ZADD', user_key, now, session_id)

-- 7. Set TTL based on session TTL (at least 1h to cover active sessions)
local ttl_seconds = math.floor(ttl / 1000)
local expire_ttl = math.max(3600, ttl_seconds)
redis.call('EXPIRE', global_key, expire_ttl)
redis.call('EXPIRE', key_key, expire_ttl)
redis.call('EXPIRE', user_key, expire_ttl)

-- 8. Return success (compute counts)
local key_count = current_key_count
local key_tracked = 0
if not is_tracked_key then
  key_count = key_count + 1
  key_tracked = 1
end

local user_count = current_user_count
local user_tracked = 0
if not is_tracked_user then
  user_count = user_count + 1
  user_tracked = 1
end

return {1, 0, key_count, key_tracked, user_count, user_tracked}
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
 * ARGV[4]: request_id（可选，用于 member 去重）
 *
 * 返回值：string - 当前窗口内的总消费
 */
export const TRACK_COST_5H_ROLLING_WINDOW = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local now_ms = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])  -- 5 hours = 18000000 ms
local request_id = ARGV[4]

-- 1. 清理过期记录（5 小时前的数据）
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. 添加当前消费记录（member = timestamp:cost 或 timestamp:requestId:cost，便于调试和追踪）
local member
if request_id and request_id ~= '' then
  member = now_ms .. ':' .. request_id .. ':' .. cost
else
  member = now_ms .. ':' .. cost
end
redis.call('ZADD', key, now_ms, member)

-- 3. 计算窗口内总消费
local records = redis.call('ZRANGE', key, 0, -1)
local total = 0
for _, record in ipairs(records) do
  -- 解析 member 格式："timestamp:cost" 或 "timestamp:id:cost"
  local cost_str = string.match(record, '.*:(.+)')
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
  local cost_str = string.match(record, '.*:(.+)')
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
 * ARGV[4]: request_id（可选，用于 member 去重）
 *
 * 返回值：string - 当前窗口内的总消费
 */
export const TRACK_COST_DAILY_ROLLING_WINDOW = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local now_ms = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])  -- 24 hours = 86400000 ms
local request_id = ARGV[4]

-- 1. 清理过期记录（24 小时前的数据）
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. 添加当前消费记录（member = timestamp:cost 或 timestamp:requestId:cost，便于调试和追踪）
local member
if request_id and request_id ~= '' then
  member = now_ms .. ':' .. request_id .. ':' .. cost
else
  member = now_ms .. ':' .. cost
end
redis.call('ZADD', key, now_ms, member)

-- 3. 计算窗口内总消费
local records = redis.call('ZRANGE', key, 0, -1)
local total = 0
for _, record in ipairs(records) do
  -- 解析 member 格式："timestamp:cost" 或 "timestamp:id:cost"
  local cost_str = string.match(record, '.*:(.+)')
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
  local cost_str = string.match(record, '.*:(.+)')
  if cost_str then
    total = total + tonumber(cost_str)
  end
end

return tostring(total)
`;
