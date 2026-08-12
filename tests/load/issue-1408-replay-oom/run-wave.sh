#!/bin/sh
set -eu

if [ "$#" -lt 5 ] || [ "$#" -gt 6 ]; then
  printf '%s\n' \
    "usage: run-wave.sh APP_URL MOCK_STATS_URL SCENARIO_PREFIX APP_CONTAINER OUTPUT [REDIS_CONTAINER]" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_url="$1"
mock_stats_url="$2"
scenario_prefix="$3"
app_container="$4"
output="$5"
redis_container="${6:-}"

waves="${CCH_WAVES:-8}"
requests_per_wave="${CCH_REQUESTS_PER_WAVE:-8}"
wave_interval_ms="${CCH_WAVE_INTERVAL_MS:-10000}"
samples="${CCH_SAMPLES:-18}"
sample_interval_seconds="${CCH_SAMPLE_INTERVAL_SECONDS:-10}"
node_bin="${NODE_BIN:-node}"
session_manifest="${CCH_SESSION_MANIFEST:-${output}.sessions.json}"
driver_output="${CCH_DRIVER_OUTPUT:-${output}.driver.jsonl}"
redis_evidence_output="${CCH_REDIS_EVIDENCE_OUTPUT:-${output}.redis.json}"
redis_expired_output="${CCH_REDIS_EXPIRED_OUTPUT:-${output}.redis-expired.json}"
response_bytes="${CCH_MOCK_RESPONSE_BYTES:-5242880}"
trigger_rdb_bgsave="${CCH_TRIGGER_RDB_BGSAVE:-false}"
rdb_delay_seconds="${CCH_RDB_DELAY_SECONDS:-70}"
verify_ttl_cleanup="${CCH_VERIFY_TTL_CLEANUP:-false}"
ttl_cleanup_timeout_seconds="${CCH_TTL_CLEANUP_TIMEOUT_SECONDS:-360}"

sampler_pid=""
ttl_stdout_tmp=""
ttl_stderr_tmp=""
cleanup() {
  if [ -n "$sampler_pid" ]; then
    kill "$sampler_pid" 2>/dev/null || true
  fi
  if [ -n "$ttl_stdout_tmp" ]; then
    rm -f -- "$ttl_stdout_tmp"
  fi
  if [ -n "$ttl_stderr_tmp" ]; then
    rm -f -- "$ttl_stderr_tmp"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

case "$rdb_delay_seconds" in
  *[!0-9]*)
    printf '%s\n' "CCH_RDB_DELAY_SECONDS must be a non-negative integer" >&2
    exit 2
    ;;
esac
case "$ttl_cleanup_timeout_seconds" in
  *[!0-9]*)
    printf '%s\n' "CCH_TTL_CLEANUP_TIMEOUT_SECONDS must be a non-negative integer" >&2
    exit 2
    ;;
esac

"$script_dir/sample-container.sh" \
  "$app_container" \
  "$output" \
  "$samples" \
  "$sample_interval_seconds" \
  "$redis_container" &
sampler_pid=$!

CCH_SESSION_MANIFEST="$session_manifest" \
  "$node_bin" "$script_dir/drive-disconnect-waves.cjs" \
  "$app_url" \
  "$mock_stats_url" \
  "$scenario_prefix" \
  "$waves" \
  "$requests_per_wave" \
  "$wave_interval_ms" >"$driver_output"
cat "$driver_output"

case "$trigger_rdb_bgsave" in
  true | 1)
    if [ -z "$redis_container" ]; then
      printf '%s\n' "CCH_TRIGGER_RDB_BGSAVE requires REDIS_CONTAINER" >&2
      exit 2
    fi
    sleep "$rdb_delay_seconds"
    docker exec "$redis_container" redis-cli BGSAVE
    rdb_wait_started=$(date +%s)
    while :; do
      rdb_in_progress=$(
        docker exec "$redis_container" redis-cli --raw INFO persistence |
          awk -F: '$1 == "rdb_bgsave_in_progress" { gsub("\r", "", $2); print $2 }'
      )
      [ "$rdb_in_progress" = "0" ] && break
      if [ $(( $(date +%s) - rdb_wait_started )) -ge 120 ]; then
        printf '%s\n' "timed out waiting for Redis BGSAVE" >&2
        exit 1
      fi
      sleep 1
    done
    ;;
  false | 0) ;;
  *)
    printf '%s\n' "CCH_TRIGGER_RDB_BGSAVE must be true, false, 1, or 0" >&2
    exit 2
    ;;
esac

if [ -n "$redis_container" ]; then
  "$node_bin" "$script_dir/inspect-redis.cjs" \
    "$redis_container" \
    "$session_manifest" \
    "$response_bytes" >"$redis_evidence_output"
  cat "$redis_evidence_output"
fi

wait "$sampler_pid"
sampler_pid=""

case "$verify_ttl_cleanup" in
  true | 1)
    if [ -z "$redis_container" ]; then
      printf '%s\n' "CCH_VERIFY_TTL_CLEANUP requires REDIS_CONTAINER" >&2
      exit 2
    fi
    ttl_wait_started=$(date +%s)
    ttl_stdout_tmp=$(mktemp "${redis_expired_output}.tmp.XXXXXX")
    ttl_stderr_tmp=$(mktemp "${redis_expired_output}.stderr.tmp.XXXXXX")
    while ! "$node_bin" "$script_dir/inspect-redis.cjs" \
      "$redis_container" \
      "$session_manifest" \
      "$response_bytes" \
      expired >"$ttl_stdout_tmp" 2>"$ttl_stderr_tmp"; do
      if [ $(( $(date +%s) - ttl_wait_started )) -ge "$ttl_cleanup_timeout_seconds" ]; then
        printf '%s\n' "timed out waiting for session response body TTL cleanup" >&2
        cat "$ttl_stdout_tmp" >&2
        cat "$ttl_stderr_tmp" >&2
        exit 1
      fi
      sleep 5
    done
    mv "$ttl_stdout_tmp" "$redis_expired_output"
    ttl_stdout_tmp=""
    rm -f -- "$ttl_stderr_tmp"
    ttl_stderr_tmp=""
    cat "$redis_expired_output"
    ;;
  false | 0) ;;
  *)
    printf '%s\n' "CCH_VERIFY_TTL_CLEANUP must be true, false, 1, or 0" >&2
    exit 2
    ;;
esac
trap - EXIT INT TERM
