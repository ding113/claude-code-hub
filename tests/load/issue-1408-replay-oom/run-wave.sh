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

sampler_pid=""
cleanup() {
  if [ -n "$sampler_pid" ]; then
    kill "$sampler_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

"$script_dir/sample-container.sh" \
  "$app_container" \
  "$output" \
  "$samples" \
  "$sample_interval_seconds" \
  "$redis_container" &
sampler_pid=$!

"$node_bin" "$script_dir/drive-disconnect-waves.cjs" \
  "$app_url" \
  "$mock_stats_url" \
  "$scenario_prefix" \
  "$waves" \
  "$requests_per_wave" \
  "$wave_interval_ms"

wait "$sampler_pid"
sampler_pid=""
trap - EXIT INT TERM
