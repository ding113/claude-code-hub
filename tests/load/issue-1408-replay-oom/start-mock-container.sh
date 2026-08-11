#!/bin/sh
set -eu

if [ "$#" -lt 3 ] || [ "$#" -gt 5 ]; then
  printf '%s\n' \
    "usage: start-mock-container.sh CONTAINER NETWORK HOST_PORT [PAYLOAD_MIB] [NODE_IMAGE]" >&2
  exit 2
fi

container="$1"
network="$2"
host_port="$3"
payload_mib="${4:-8}"
node_image="${5:-node:22-alpine}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if docker container inspect "$container" >/dev/null 2>&1; then
  printf '%s\n' "container already exists: $container" >&2
  exit 1
fi

docker run -d \
  --name "$container" \
  --network "$network" \
  -e CCH_MOCK_PORT=3001 \
  -e CCH_MOCK_MIB="$payload_mib" \
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
  if curl -fsS "http://127.0.0.1:$host_port/health" >/dev/null 2>&1; then
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
