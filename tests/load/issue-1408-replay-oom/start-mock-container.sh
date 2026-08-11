#!/bin/sh
set -eu

if [ "$#" -lt 3 ] || [ "$#" -gt 6 ]; then
  printf '%s\n' \
    "usage: start-mock-container.sh CONTAINER NETWORK HOST_PORT [RESPONSE_BYTES] [RESPONSE_MODE] [NODE_IMAGE]" >&2
  exit 2
fi

container="$1"
network="$2"
host_port="$3"
response_bytes="${4:-5242880}"
response_mode="${5:-disconnect}"
node_image="${6:-node:22-alpine}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

case "$response_bytes" in
  *[!0-9]* | "")
    printf '%s\n' "RESPONSE_BYTES must be an integer between 65536 and 67108864" >&2
    exit 2
    ;;
esac
if [ "$response_bytes" -lt 65536 ] || [ "$response_bytes" -gt 67108864 ]; then
  printf '%s\n' "RESPONSE_BYTES must be an integer between 65536 and 67108864" >&2
  exit 2
fi
case "$response_mode" in
  disconnect | complete) ;;
  *)
    printf '%s\n' "RESPONSE_MODE must be disconnect or complete" >&2
    exit 2
    ;;
esac

if docker container inspect "$container" >/dev/null 2>&1; then
  printf '%s\n' "container already exists: $container" >&2
  exit 1
fi

docker run -d \
  --name "$container" \
  --network "$network" \
  -e CCH_MOCK_PORT=3001 \
  -e CCH_MOCK_RESPONSE_BYTES="$response_bytes" \
  -e CCH_MOCK_RESPONSE_MODE="$response_mode" \
  -p "127.0.0.1:$host_port:3001" \
  -v "$script_dir/mock-upstream.cjs:/fixture/mock-upstream.cjs:ro" \
  "$node_image" \
  node /fixture/mock-upstream.cjs >/dev/null

cleanup_container() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}

trap cleanup_container 0
trap 'exit 130' 2
trap 'exit 143' 15

attempt=0
while [ "$attempt" -lt 60 ]; do
  if curl --connect-timeout 2 --max-time 5 -fsS \
    "http://127.0.0.1:$host_port/health" >/dev/null 2>&1; then
    trap - 0 2 15
    printf '%s\n' \
      "ready container=$container stats=http://127.0.0.1:$host_port/stats provider=http://$container:3001"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done

docker logs --tail 100 "$container" >&2 || true
exit 1
