#!/bin/sh
set -eu

if [ "$#" -lt 2 ] || [ "$#" -gt 5 ]; then
  printf '%s\n' \
    "usage: sample-container.sh APP_CONTAINER OUTPUT [SAMPLES] [INTERVAL_SECONDS] [REDIS_CONTAINER]" >&2
  exit 2
fi

app="$1"
output="$2"
samples="${3:-18}"
interval="${4:-10}"
redis="${5:-}"

container_cgroup_metric() {
  container="$1"
  metric="$2"
  pid=$(docker inspect -f '{{.State.Pid}}' "$container" 2>/dev/null || true)
  case "$pid" in
    *[!0-9]* | "" | 0) return ;;
  esac
  cgroup_path=$(awk -F: '$1 == "0" { print $3 }' "/proc/$pid/cgroup" 2>/dev/null || true)
  [ -n "$cgroup_path" ] || return
  metric_path="/sys/fs/cgroup${cgroup_path}/${metric}"
  [ -r "$metric_path" ] && tr -d '\n' <"$metric_path"
}

case "$samples" in
  *[!0-9]* | 0) printf '%s\n' "SAMPLES must be a positive integer" >&2; exit 2 ;;
esac
case "$interval" in
  *[!0-9]*) printf '%s\n' "INTERVAL_SECONDS must be a non-negative integer" >&2; exit 2 ;;
esac

start_epoch=$(date +%s)
: >"$output"
i=0
while [ "$i" -lt "$samples" ]; do
  epoch=$(date +%s)
  state=$(docker inspect -f '{{.State.Status}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}}' "$app" 2>/dev/null || true)
  app_memory_current=$(container_cgroup_metric "$app" memory.current)
  app_memory_peak=$(container_cgroup_metric "$app" memory.peak)
  logs=$(docker logs --since "$start_epoch" "$app" 2>&1 || true)
  memory=$(printf '%s\n' "$logs" | grep '"cchMemoryProbe":true' | tail -n 1 || true)
  timeouts=$(printf '%s\n' "$logs" | grep -c 'Client abort drain window exceeded' || true)
  backlogs=$(printf '%s\n' "$logs" | grep -c 'write_backlog_too_large' || true)
  body_skips=$(printf '%s\n' "$logs" | grep -c 'Skipped oversized session response body' || true)
  active=$(printf '%s\n' "$logs" | grep -E 'activeTasks|remainingTasks' | tail -n 1 || true)

  redis_state=""
  redis_memory=""
  redis_persistence=""
  redis_memory_current=""
  redis_memory_peak=""
  redis_body_bundles=""
  redis_replay_owners=""
  redis_replay_meta=""
  redis_replay_chunks=""
  if [ -n "$redis" ]; then
    redis_state=$(docker inspect -f '{{.State.Status}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}}' "$redis" 2>/dev/null || true)
    redis_memory_current=$(container_cgroup_metric "$redis" memory.current)
    redis_memory_peak=$(container_cgroup_metric "$redis" memory.peak)
    redis_memory=$(docker exec "$redis" redis-cli --raw INFO memory 2>/dev/null |
      grep -E '^(used_memory|used_memory_peak):' |
      tr '\n' ',' || true)
    redis_persistence=$(docker exec "$redis" redis-cli --raw INFO persistence 2>/dev/null |
      grep -E '^(rdb_bgsave_in_progress|rdb_last_bgsave_status|rdb_saves|rdb_last_cow_size|rdb_last_save_time):' |
      tr '\n' ',' || true)
    redis_body_bundles=$(docker exec "$redis" redis-cli --scan --pattern 'session:*:response-bodies:v1' 2>/dev/null | wc -l | tr -d ' ')
    redis_replay_owners=$(docker exec "$redis" redis-cli --scan --pattern 'cch:replay:owner:*' 2>/dev/null | wc -l | tr -d ' ')
    redis_replay_meta=$(docker exec "$redis" redis-cli --scan --pattern 'cch:replay:meta:*' 2>/dev/null | wc -l | tr -d ' ')
    redis_replay_chunks=$(docker exec "$redis" redis-cli --scan --pattern 'cch:replay:chunks:*' 2>/dev/null | wc -l | tr -d ' ')
  fi

  printf '%s\n' \
    "sample=$i epoch=$epoch app=[$state] appMemoryCurrent=$app_memory_current appMemoryPeak=$app_memory_peak timeouts=$timeouts backlogs=$backlogs bodySkips=$body_skips memory=$memory lastTask=$active redis=[$redis_state] redisMemoryCurrent=$redis_memory_current redisMemoryPeak=$redis_memory_peak redisMemory=[$redis_memory] redisPersistence=[$redis_persistence] responseBodyBundles=$redis_body_bundles replayOwners=$redis_replay_owners replayMeta=$redis_replay_meta replayChunks=$redis_replay_chunks" \
    >>"$output"
  i=$((i + 1))
  [ "$i" -ge "$samples" ] || sleep "$interval"
done
