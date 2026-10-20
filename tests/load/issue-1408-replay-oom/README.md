# Issue 1408 Replay OOM Load Fixture

This fixture reproduces the client-disconnect workload used to isolate issue #1408. It keeps the
mock upstream response open after sending a bounded SSE payload, disconnects each client only after
the mock confirms receipt, and samples Node, socket, task, timeout, and Redis state.

The fixture is intentionally separate from the regular Vitest suite because it needs a configured
CC Hub instance, PostgreSQL, Redis, a Provider pointing at the mock, an API key, and Docker metrics.

## Files

- `mock-upstream.cjs`: sends an exact-size SSE body. `CCH_MOCK_RESPONSE_MODE=disconnect` (the
  default) leaves the stream open after the delta frames for the #1408 abort reproduction;
  `complete` appends a terminal `response.completed` event and closes the response for #1415
  storage acceptance. `CCH_MOCK_RESPONSE_BYTES` controls total wire bytes from 64 KiB to 64 MiB.
- `drive-disconnect-waves.cjs`: sends distinct `/v1/responses` Replay requests in waves, waits for
  the mock receipt count, then either disconnects after `CCH_ABORT_DELAY_MS` or waits for every
  response to complete when `CCH_REQUEST_MODE=complete`, and writes exact session IDs to a manifest.
- `memory-probe.cjs`: preload hook that emits RSS, V8 heap, external, ArrayBuffer, and active resource
  counts as JSON.
- `sample-container.sh`: samples app logs, cgroup current/peak memory, Redis memory, RDB state, and
  response/Replay key counts into a result file.
- `inspect-redis.cjs`: validates each manifest response bundle with Redis `HSTRLEN`, refs, TTL,
  stale legacy keys, RDB status, and container exit/OOM state.
- `run-wave.sh`: runs the driver and sampler together, optionally triggers `BGSAVE`, then writes
  driver, manifest, and Redis evidence artifacts next to the sample output.
- `start-mock-container.sh`: starts the mock on an existing Docker network without replacing an
  existing container.

## Prerequisites

1. Build or select the CC Hub image/revision under test.
2. Start PostgreSQL and create a test database containing a Provider and API key for the fixture.
3. Create a Docker network shared by the app, Redis, and mock.
4. Configure the Provider base URL as `http://MOCK_CONTAINER:3001` and route model `gpt-5.6` to it.
5. Start the app with the probe preloaded. For a container, mount `memory-probe.cjs` read-only and
   set `NODE_OPTIONS=--require=/fixture/memory-probe.cjs`.
6. For response body dedup validation, set `STORE_SESSION_RESPONSE_BODY=true`,
   `SESSION_RESPONSE_BODY_DEDUP_ENABLED=true`, and
   `SESSION_RESPONSE_BODY_MAX_BYTES=5242880`. Use an isolated Redis with RDB enabled.

Do not point this fixture at a production Provider. The default mock mode deliberately leaves every
upstream response open until the app or fixture closes it.

## Start The Mock

```bash
tests/load/issue-1408-replay-oom/start-mock-container.sh \
  cch1408-mock cch1408-network 31409 5242880
```

The command prints both URLs:

```text
stats=http://127.0.0.1:31409/stats
provider=http://cch1408-mock:3001
```

For Issue #1415 completed-response storage acceptance, pass `complete` as the fifth argument:

```bash
tests/load/issue-1408-replay-oom/start-mock-container.sh \
  cch1415-mock cch1415-network 31409 5242880 complete
```

## Run A Wave Test

Store the test API key in a protected file outside the repository, then run:

```bash
export CCH_API_KEY_FILE=/path/to/test-api-key
export CCH_MOCK_RESPONSE_BYTES=5242880
export CCH_REQUEST_MODE=complete
export CCH_COMPLETION_TIMEOUT_MS=60000
export CCH_TRIGGER_RDB_BGSAVE=true
export CCH_RDB_DELAY_SECONDS=70
export CCH_SAMPLES=36
export CCH_VERIFY_TTL_CLEANUP=true
export CCH_TTL_CLEANUP_TIMEOUT_SECONDS=360

tests/load/issue-1408-replay-oom/run-wave.sh \
  http://127.0.0.1:31415 \
  http://127.0.0.1:31409/stats \
  issue1408-fixed \
  cch1408-app \
  issue1408-fixed.samples.txt \
  cch1408-redis
```

Defaults match the investigation workload:

```text
CCH_WAVES=8
CCH_REQUESTS_PER_WAVE=8
CCH_WAVE_INTERVAL_MS=10000
CCH_ABORT_DELAY_MS=250
CCH_REQUEST_MODE=disconnect
CCH_COMPLETION_TIMEOUT_MS=60000
CCH_SAMPLES=18
CCH_SAMPLE_INTERVAL_SECONDS=10
CCH_MOCK_RESPONSE_BYTES=5242880
CCH_TRIGGER_RDB_BGSAVE=false
CCH_RDB_DELAY_SECONDS=70
CCH_VERIFY_TTL_CLEANUP=false
CCH_TTL_CLEANUP_TIMEOUT_SECONDS=360
```

The output argument is the prefix for four artifacts, plus a fifth artifact when TTL cleanup
verification is enabled:

```text
issue1408-fixed.samples.txt
issue1408-fixed.samples.txt.driver.jsonl
issue1408-fixed.samples.txt.sessions.json
issue1408-fixed.samples.txt.redis.json
issue1408-fixed.samples.txt.redis-expired.json
```

The active Redis artifact is captured immediately after the requested `BGSAVE` completes, while
the response bodies are still inside `SESSION_TTL`. Sampling then continues for the configured
window. With `CCH_VERIFY_TTL_CLEANUP=true`, the runner polls the same manifest until every bundle
and legacy response body key has expired, then writes the separate expired artifact. The timeout
must be long enough to cover the maximum remaining `SESSION_TTL` after sampling.

`CCH_MOCK_MIB` remains a compatibility fallback when `CCH_MOCK_RESPONSE_BYTES` is unset. It is not
used for the 5 MiB acceptance run because the acceptance measures total wire bytes, including SSE
envelopes and the terminal event.

Use a unique scenario prefix for every run. Replay identity includes the scenario, wave, and request
index, so a unique prefix prevents a previous durable Replay entry from turning the workload into a
cache hit. Scenario prefixes accept 1 to 64 ASCII letters, digits, underscores, and hyphens. The
driver destroys all requests if mock receipt confirmation fails, so a failed run does not leave its
own upstream streams active.

## Acceptance Signals

For the fixed revision under the default workload:

- Node heap remains bounded while external and ArrayBuffer memory follow active stream count.
- `write_backlog_too_large` makes an inactive Replay spool fall back to the 60-second drain window.
- Every disconnected task reaches `Client abort drain window exceeded` and the active task count
  returns to zero.
- After a quiet GC period, external and ArrayBuffer memory return near the pre-wave baseline.
- The Redis evidence reports 64 bundles, one `body:*` field and three identical refs per bundle,
  zero dangling refs, and zero old response body keys.
- `summary.totalRawBodyBytes` is no greater than `64 * 5242880`, and every bundle's raw `HSTRLEN`
  equals its declared `total_bytes`.
- Redis remains running across `BGSAVE`, `rdb_last_bgsave_status=ok`, and both app and Redis report
  `OOMKilled=false` with non-error exit state.
- The expired Redis evidence reports zero remaining manifest bundles and zero legacy response body
  keys after `SESSION_TTL`. Replay meta may remain until its own TTL; owner and chunk counts are
  reported separately and must not be conflated with response body cleanup.

The historical measurements and the exact evidence boundary are documented in
`docs/troubleshooting/issue-1408-replay-oom.md`.
