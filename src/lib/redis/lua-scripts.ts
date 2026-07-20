/**
 * Redis Lua 脚本集合
 *
 * 用于保证 Redis 操作的原子性
 */

/**
 * Delete a legacy provider mirror only when it still contains the value that
 * the guarded fallback mutation wrote. This is intentionally single-key so it
 * remains usable on Redis Cluster when the multi-key binding scripts are not.
 */
export const DELETE_LEGACY_PROVIDER_IF_VALUE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Restore a legacy provider mirror only when the guarded fallback clear left
 * it absent. The conditional write keeps a concurrent versioned writer's
 * newer mirror value intact.
 */
export const RESTORE_LEGACY_PROVIDER_IF_ABSENT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('SETEX', KEYS[1], ARGV[2], ARGV[1])
  return 1
end
return 0
`;

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
 * KEYS[2]: provider:${providerId}:active_session_refs
 * ARGV[1]: sessionId
 * ARGV[2]: limit (concurrency limit)
 * ARGV[3]: now (current timestamp, ms)
 * ARGV[4]: ttlMs (optional, cleanup window in ms, default 300000)
 *
 * Return:
 * - {1, count, 1, 1} - allowed (new tracking), returns new count, tracked=1, referenced=1
 * - {1, count, 0, 1} - allowed (already tracked with refs), returns count, tracked=0, referenced=1
 * - {1, count, 0, 0} - allowed (legacy tracked without refs), returns count, tracked=0, referenced=0
 * - {0, count, 0, 0} - rejected (limit reached), returns current count and tracked=0
 */
export const CHECK_AND_TRACK_SESSION = `
local provider_key = KEYS[1]
local ref_key = KEYS[2]
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
local expired_sessions = redis.call('ZRANGEBYSCORE', provider_key, '-inf', cutoff)
redis.call('ZREMRANGEBYSCORE', provider_key, '-inf', cutoff)
for _, expired_session_id in ipairs(expired_sessions) do
  redis.call('HDEL', ref_key, expired_session_id)
end

-- 2. Check if session is already tracked
local is_tracked = redis.call('ZSCORE', provider_key, session_id)

-- Direct cleanup paths may remove the ZSET member before this script sees the session again.
-- When the member is absent, discard any stale reference hash value before acquiring a new ref.
if not is_tracked then
  redis.call('HDEL', ref_key, session_id)
end

local existing_refs = tonumber(redis.call('HGET', ref_key, session_id) or '0')

-- 3. Get current concurrency count
local current_count = redis.call('ZCARD', provider_key)

-- 4. Check limit (exclude already tracked session)
if limit > 0 and not is_tracked and current_count >= limit then
  return {0, current_count, 0, 0}  -- {allowed=false, current_count, tracked=0, referenced=0}
end

-- 5. Track session (ZADD updates timestamp for existing members)
redis.call('ZADD', provider_key, now, session_id)

local referenced = 0
if not is_tracked or existing_refs > 0 then
  redis.call('HINCRBY', ref_key, session_id, 1)
  referenced = 1
end

-- 6. Set TTL based on session TTL (at least 1h to cover active sessions)
local ttl_seconds = math.floor(ttl / 1000)
local expire_ttl = math.max(3600, ttl_seconds)
redis.call('EXPIRE', provider_key, expire_ttl)
redis.call('EXPIRE', ref_key, expire_ttl)

-- 7. Return success
if is_tracked then
  -- Already tracked, count unchanged
  return {1, current_count, 0, referenced}  -- {allowed=true, count, tracked=0, referenced}
else
  -- New tracking, count +1
  return {1, current_count + 1, 1, referenced}  -- {allowed=true, new_count, tracked=1, referenced=1}
end
`;

/**
 * Release provider-level active session membership with per-session references.
 *
 * KEYS[1]: provider:${providerId}:active_sessions
 * KEYS[2]: provider:${providerId}:active_session_refs
 * ARGV[1]: sessionId
 *
 * Return: {removed, remainingRefs}
 */
export const RELEASE_PROVIDER_SESSION = `
local provider_key = KEYS[1]
local ref_key = KEYS[2]
local session_id = ARGV[1]

local current_refs = tonumber(redis.call('HGET', ref_key, session_id) or '0')
if current_refs <= 0 then
  return {0, 0}
end

local remaining_refs = current_refs - 1
if remaining_refs > 0 then
  redis.call('HSET', ref_key, session_id, remaining_refs)
  return {0, remaining_refs}
end

redis.call('HDEL', ref_key, session_id)
local removed = redis.call('ZREM', provider_key, session_id)
return {removed, remaining_refs}
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
 * Redis Cluster 注意：
 * - 该脚本同时操作多个 key，因此 KEYS[1..3] 必须共享相同 hash tag（例如 {active_sessions}），否则会触发 CROSSSLOT。
 *
 * KEYS[1]: {active_sessions}:global:active_sessions
 * KEYS[2]: {active_sessions}:key:${keyId}:active_sessions
 * KEYS[3]: {active_sessions}:user:${userId}:active_sessions
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
-- 说明：User 上限以 user ZSET 为准；key ZSET 不参与 user 维度的“已追踪”判定，避免绕过 user 并发限制。
if user_limit > 0 and not is_tracked_user and current_user_count >= user_limit then
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
 * 追踪滚动窗口消费（写路径专用，使用 ZSET）
 *
 * 写路径只负责清理、追加和恢复 TTL。精确总额由 GET 脚本在真正需要
 * 限额判断时计算，避免每次成功请求都扫描整个窗口。
 *
 * KEYS[1]: {entity}:${id}:cost_{window}_rolling
 * ARGV[1]: cost（本次消费金额）
 * ARGV[2]: now（当前时间戳，毫秒）
 * ARGV[3]: window（窗口时长，毫秒）
 * ARGV[4]: request_id（可选，用于相同时间轴上的 member 去重）
 * ARGV[5]: ttl_seconds（兜底 TTL，秒）
 *
 * 返回值：integer - 1 表示写入完成
 */
export const TRACK_COST_ROLLING_WINDOW = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local now_ms = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])
local request_id = ARGV[4]
local ttl_seconds = tonumber(ARGV[5])

if not cost or not now_ms or not window_ms or not ttl_seconds then
  return redis.error_reply('invalid rolling cost arguments')
end

-- 1. 清理窗口外的消费记录
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. 添加当前消费记录（member = timestamp:cost 或 timestamp:requestId:cost，便于调试和追踪）
local member
if request_id and request_id ~= '' then
  member = now_ms .. ':' .. request_id .. ':' .. cost
else
  member = now_ms .. ':' .. cost
end
redis.call('ZADD', key, now_ms, member)

-- 3. 恢复兜底 TTL，允许写路径修复缺失 TTL 的合法或脏 ZSET
redis.call('EXPIRE', key, ttl_seconds)

return 1
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

/**
 * Atomically read a tenant-scoped session binding and reconcile it with the
 * legacy session-only mirror during a rolling upgrade.
 *
 * KEYS[1]: canonical binding hash
 * KEYS[2]: legacy provider string
 * KEYS[3]: legacy key owner string
 * ARGV[1]: current key id
 * ARGV[2]: generation to use when initializing/upgrading
 * ARGV[3]: binding TTL in seconds
 *
 * Return:
 * - {"ok", source, generation, providerIdOrEmpty}
 * - {"conflict", reason}
 */
export const READ_OR_RECONCILE_SESSION_BINDING = `
local binding_key = KEYS[1]
local legacy_provider_key = KEYS[2]
local legacy_owner_key = KEYS[3]

local current_key_id = ARGV[1]
local new_generation = ARGV[2]
local ttl = tonumber(ARGV[3])

local function is_positive_integer(value)
  local parsed = tonumber(value)
  return parsed and parsed > 0 and parsed == math.floor(parsed)
end

if not ttl or ttl <= 0 or current_key_id == '' or new_generation == '' then
  return {'conflict', 'invalid_input'}
end

local legacy_provider = redis.call('GET', legacy_provider_key)
local legacy_owner = redis.call('GET', legacy_owner_key)
local binding_exists = redis.call('EXISTS', binding_key) == 1

if binding_exists then
  local binding = redis.call('HMGET', binding_key, 'key_id', 'generation', 'provider_id')
  local binding_key_id = binding[1]
  local generation = binding[2]
  local provider_id = binding[3]

  if not binding_key_id or not generation or binding_key_id == '' or generation == '' then
    return {'conflict', 'canonical_corrupt'}
  end
  if binding_key_id ~= current_key_id then
    return {'conflict', 'canonical_key_mismatch'}
  end
  if not legacy_owner then
    return {'conflict', 'mirror_missing'}
  end
  if legacy_owner ~= current_key_id then
    return {'conflict', 'foreign_legacy_owner'}
  end

  if provider_id then
    if not is_positive_integer(provider_id) then
      return {'conflict', 'canonical_corrupt'}
    end
    if legacy_provider ~= provider_id then
      return {'conflict', 'mirror_conflict'}
    end
    redis.call('EXPIRE', legacy_provider_key, ttl)
  elseif legacy_provider then
    return {'conflict', 'mirror_conflict'}
  end

  redis.call('EXPIRE', binding_key, ttl)
  redis.call('EXPIRE', legacy_owner_key, ttl)
  return {'ok', 'existing', generation, provider_id or ''}
end

if legacy_owner and legacy_owner ~= current_key_id then
  return {'conflict', 'foreign_legacy_owner'}
end
if legacy_provider and not legacy_owner then
  return {'conflict', 'orphan_legacy_provider'}
end
if legacy_provider and not is_positive_integer(legacy_provider) then
  return {'conflict', 'invalid_legacy_provider'}
end

if not legacy_owner and not legacy_provider then
  redis.call('HSET', binding_key, 'key_id', current_key_id, 'generation', new_generation)
  redis.call('HDEL', binding_key, 'provider_id')
  redis.call('EXPIRE', binding_key, ttl)
  redis.call('SETEX', legacy_owner_key, ttl, current_key_id)
  return {'ok', 'created', new_generation, ''}
end

-- At this point the legacy owner is current_key_id. The provider may be absent,
-- which is the valid null-binding mirror used by a fresh session.
redis.call('HSET', binding_key, 'key_id', current_key_id, 'generation', new_generation)
if legacy_provider then
  redis.call('HSET', binding_key, 'provider_id', legacy_provider)
  redis.call('EXPIRE', legacy_provider_key, ttl)
else
  redis.call('HDEL', binding_key, 'provider_id')
end
redis.call('EXPIRE', binding_key, ttl)
redis.call('EXPIRE', legacy_owner_key, ttl)
return {'ok', 'legacy_upgraded', new_generation, legacy_provider or ''}
`;

/**
 * Compare-and-set a provider on an existing versioned session binding.
 * The canonical hash and both legacy mirrors are validated before dual-write.
 * Missing canonical state is always a conflict and is never initialized here.
 *
 * KEYS[1]: canonical binding hash
 * KEYS[2]: legacy provider string
 * KEYS[3]: legacy key owner string
 * ARGV[1]: current key id
 * ARGV[2]: expected generation
 * ARGV[3]: next generation
 * ARGV[4]: next provider id
 * ARGV[5]: binding TTL in seconds
 */
export const CAS_SESSION_BINDING = `
local binding_key = KEYS[1]
local legacy_provider_key = KEYS[2]
local legacy_owner_key = KEYS[3]

local current_key_id = ARGV[1]
local expected_generation = ARGV[2]
local next_generation = ARGV[3]
local next_provider_id = ARGV[4]
local ttl = tonumber(ARGV[5])

local function is_positive_integer(value)
  local parsed = tonumber(value)
  return parsed and parsed > 0 and parsed == math.floor(parsed)
end

if not ttl or ttl <= 0 or current_key_id == '' or expected_generation == '' or
   next_generation == '' or not is_positive_integer(next_provider_id) then
  return {'conflict', 'invalid_input'}
end
if redis.call('EXISTS', binding_key) == 0 then
  return {'conflict', 'canonical_missing'}
end

local binding = redis.call('HMGET', binding_key, 'key_id', 'generation', 'provider_id')
local binding_key_id = binding[1]
local generation = binding[2]
local current_provider_id = binding[3]

if not binding_key_id or not generation or binding_key_id == '' or generation == '' then
  return {'conflict', 'canonical_corrupt'}
end
if binding_key_id ~= current_key_id then
  return {'conflict', 'canonical_key_mismatch'}
end
if generation ~= expected_generation then
  return {'conflict', 'generation_mismatch'}
end

local legacy_owner = redis.call('GET', legacy_owner_key)
local legacy_provider = redis.call('GET', legacy_provider_key)
if current_provider_id and not is_positive_integer(current_provider_id) then
  return {'conflict', 'canonical_corrupt'}
end
if legacy_provider and not is_positive_integer(legacy_provider) then
  return {'conflict', 'invalid_legacy_provider'}
end
if not legacy_owner then
  return {'conflict', 'mirror_missing'}
end
if legacy_owner ~= current_key_id then
  return {'conflict', 'foreign_legacy_owner'}
end
if current_provider_id then
  if legacy_provider ~= current_provider_id then
    return {'conflict', 'mirror_conflict'}
  end
elseif legacy_provider then
  return {'conflict', 'mirror_conflict'}
end

redis.call('HSET', binding_key,
  'key_id', current_key_id,
  'generation', next_generation,
  'provider_id', next_provider_id)
redis.call('EXPIRE', binding_key, ttl)
redis.call('SETEX', legacy_owner_key, ttl, current_key_id)
redis.call('SETEX', legacy_provider_key, ttl, next_provider_id)
return {'ok', 'updated', next_generation, next_provider_id}
`;

/**
 * Compare-and-clear an existing versioned session binding. A cooldown marker
 * may be written in the same transaction when clearing a timed-out provider.
 *
 * KEYS[1]: canonical binding hash
 * KEYS[2]: legacy provider string
 * KEYS[3]: legacy key owner string
 * KEYS[4]: tenant-scoped cooldown key (unused when cooldown TTL is zero)
 * ARGV[1]: current key id
 * ARGV[2]: expected generation
 * ARGV[3]: next generation
 * ARGV[4]: expected provider id, or empty for a null binding
 * ARGV[5]: binding TTL in seconds
 * ARGV[6]: cooldown provider id, or empty
 * ARGV[7]: cooldown TTL in seconds, or zero
 */
export const CLEAR_SESSION_BINDING = `
local binding_key = KEYS[1]
local legacy_provider_key = KEYS[2]
local legacy_owner_key = KEYS[3]
local cooldown_key = KEYS[4]

local current_key_id = ARGV[1]
local expected_generation = ARGV[2]
local next_generation = ARGV[3]
local expected_provider_id = ARGV[4]
local ttl = tonumber(ARGV[5])
local cooldown_provider_id = ARGV[6]
local cooldown_ttl = tonumber(ARGV[7]) or 0

local function is_positive_integer(value)
  local parsed = tonumber(value)
  return parsed and parsed > 0 and parsed == math.floor(parsed)
end

if not ttl or ttl <= 0 or current_key_id == '' or expected_generation == '' or
   next_generation == '' or cooldown_ttl < 0 then
  return {'conflict', 'invalid_input'}
end
if cooldown_ttl > 0 and
   (not is_positive_integer(expected_provider_id) or
    cooldown_provider_id ~= expected_provider_id) then
  return {'conflict', 'invalid_input'}
end
if redis.call('EXISTS', binding_key) == 0 then
  return {'conflict', 'canonical_missing'}
end

local binding = redis.call('HMGET', binding_key, 'key_id', 'generation', 'provider_id')
local binding_key_id = binding[1]
local generation = binding[2]
local current_provider_id = binding[3]

if not binding_key_id or not generation or binding_key_id == '' or generation == '' then
  return {'conflict', 'canonical_corrupt'}
end
if binding_key_id ~= current_key_id then
  return {'conflict', 'canonical_key_mismatch'}
end
if generation ~= expected_generation then
  return {'conflict', 'generation_mismatch'}
end
if (current_provider_id or '') ~= expected_provider_id then
  return {'conflict', 'provider_mismatch'}
end

local legacy_owner = redis.call('GET', legacy_owner_key)
local legacy_provider = redis.call('GET', legacy_provider_key)
if current_provider_id and not is_positive_integer(current_provider_id) then
  return {'conflict', 'canonical_corrupt'}
end
if legacy_provider and not is_positive_integer(legacy_provider) then
  return {'conflict', 'invalid_legacy_provider'}
end
if not legacy_owner then
  return {'conflict', 'mirror_missing'}
end
if legacy_owner ~= current_key_id then
  return {'conflict', 'foreign_legacy_owner'}
end
if current_provider_id then
  if legacy_provider ~= current_provider_id then
    return {'conflict', 'mirror_conflict'}
  end
elseif legacy_provider then
  return {'conflict', 'mirror_conflict'}
end

redis.call('HSET', binding_key, 'key_id', current_key_id, 'generation', next_generation)
redis.call('HDEL', binding_key, 'provider_id')
redis.call('EXPIRE', binding_key, ttl)
redis.call('SETEX', legacy_owner_key, ttl, current_key_id)
redis.call('DEL', legacy_provider_key)

if cooldown_ttl > 0 then
  redis.call('SETEX', cooldown_key, cooldown_ttl, next_generation)
end

return {'ok', 'cleared', next_generation, ''}
`;

/**
 * Tenant-authorized administrative termination. Unlike request-level clear,
 * this operation intentionally does not compare an old generation. It still
 * validates canonical ownership and both legacy mirrors before rotating the
 * generation and leaving a null tombstone.
 *
 * KEYS[1]: canonical binding hash
 * KEYS[2]: legacy provider string
 * KEYS[3]: legacy key owner string
 * ARGV[1]: current key id
 * ARGV[2]: next generation
 * ARGV[3]: binding TTL in seconds
 * ARGV[4]: optional expected provider id for conditional batch termination
 */
export const TERMINATE_SESSION_BINDING = `
local binding_key = KEYS[1]
local legacy_provider_key = KEYS[2]
local legacy_owner_key = KEYS[3]

local current_key_id = ARGV[1]
local next_generation = ARGV[2]
local ttl = tonumber(ARGV[3])
local expected_provider_id = ARGV[4]

local function is_positive_integer(value)
  local parsed = tonumber(value)
  return parsed and parsed > 0 and parsed == math.floor(parsed)
end

if not ttl or ttl <= 0 or current_key_id == '' or next_generation == '' or
   (expected_provider_id ~= '' and not is_positive_integer(expected_provider_id)) then
  return {'conflict', 'invalid_input'}
end
if redis.call('EXISTS', binding_key) == 0 then
  return {'conflict', 'canonical_missing'}
end

local binding = redis.call('HMGET', binding_key, 'key_id', 'generation', 'provider_id')
local binding_key_id = binding[1]
local generation = binding[2]
local current_provider_id = binding[3]

if not binding_key_id or not generation or binding_key_id == '' or generation == '' then
  return {'conflict', 'canonical_corrupt'}
end
if binding_key_id ~= current_key_id then
  return {'conflict', 'canonical_key_mismatch'}
end
if current_provider_id and not is_positive_integer(current_provider_id) then
  return {'conflict', 'canonical_corrupt'}
end
if expected_provider_id ~= '' and (current_provider_id or '') ~= expected_provider_id then
  return {'conflict', 'provider_mismatch'}
end

local legacy_owner = redis.call('GET', legacy_owner_key)
local legacy_provider = redis.call('GET', legacy_provider_key)
if legacy_provider and not is_positive_integer(legacy_provider) then
  return {'conflict', 'invalid_legacy_provider'}
end
if not legacy_owner then
  return {'conflict', 'mirror_missing'}
end
if legacy_owner ~= current_key_id then
  return {'conflict', 'foreign_legacy_owner'}
end
if current_provider_id then
  if legacy_provider ~= current_provider_id then
    return {'conflict', 'mirror_conflict'}
  end
elseif legacy_provider then
  return {'conflict', 'mirror_conflict'}
end

redis.call('HSET', binding_key, 'key_id', current_key_id, 'generation', next_generation)
redis.call('HDEL', binding_key, 'provider_id')
redis.call('EXPIRE', binding_key, ttl)
redis.call('SETEX', legacy_owner_key, ttl, current_key_id)
redis.call('DEL', legacy_provider_key)
return {'ok', 'terminated', next_generation, ''}
`;
