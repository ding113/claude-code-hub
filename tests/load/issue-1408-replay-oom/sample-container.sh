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
  logs=$(docker logs --since "$start_epoch" "$app" 2>&1 || true)
  memory=$(printf '%s\n' "$logs" | grep '"cchMemoryProbe":true' | tail -n 1 || true)
  timeouts=$(printf '%s\n' "$logs" | grep -c 'Client abort drain window exceeded' || true)
  backlogs=$(printf '%s\n' "$logs" | grep -c 'write_backlog_too_large' || true)
  body_skips=$(printf '%s\n' "$logs" | grep -c 'Skipped oversized session response body' || true)
  active=$(printf '%s\n' "$logs" | grep -E 'activeTasks|remainingTasks' | tail -n 1 || true)

  redis_state=""
  redis_memory=""
  if [ -n "$redis" ]; then
    redis_state=$(docker inspect -f '{{.State.Status}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}}' "$redis" 2>/dev/null || true)
    redis_memory=$(docker exec "$redis" redis-cli --raw INFO memory 2>/dev/null |
      grep -E '^(used_memory_human|used_memory_peak_human):' |
      tr '\n' ',' || true)
  fi

  printf '%s\n' \
    "sample=$i epoch=$epoch app=[$state] timeouts=$timeouts backlogs=$backlogs bodySkips=$body_skips memory=$memory lastTask=$active redis=[$redis_state] redisMemory=[$redis_memory]" \
    >>"$output"
  i=$((i + 1))
  [ "$i" -ge "$samples" ] || sleep "$interval"
done
