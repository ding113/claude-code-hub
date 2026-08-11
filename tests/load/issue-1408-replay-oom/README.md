# Issue 1408 Replay OOM Load Fixture

This fixture reproduces the client-disconnect workload used to isolate issue #1408. It keeps the
mock upstream response open after sending a bounded SSE payload, disconnects each client only after
the mock confirms receipt, and samples Node, socket, task, timeout, and Redis state.

The fixture is intentionally separate from the regular Vitest suite because it needs a configured
CC Hub instance, PostgreSQL, Redis, a Provider pointing at the mock, an API key, and Docker metrics.

## Files

- `mock-upstream.cjs`: sends `response.output_text.delta` frames, then remains open without a
  terminal event. `CCH_MOCK_MIB` controls the payload size from 0.0625 to 64 MiB per request.
- `drive-disconnect-waves.cjs`: sends distinct `/v1/responses` Replay requests in waves, waits for
  the mock receipt count, then disconnects the clients after `CCH_ABORT_DELAY_MS`.
- `memory-probe.cjs`: preload hook that emits RSS, V8 heap, external, ArrayBuffer, and active resource
  counts as JSON.
- `sample-container.sh`: samples app logs and optional Redis state into a result file.
- `run-wave.sh`: runs the driver and sampler together.
- `start-mock-container.sh`: starts the mock on an existing Docker network without replacing an
  existing container.

## Prerequisites

1. Build or select the CC Hub image/revision under test.
2. Start PostgreSQL and create a test database containing a Provider and API key for the fixture.
3. Create a Docker network shared by the app, Redis, and mock.
4. Configure the Provider base URL as `http://MOCK_CONTAINER:3001` and route model `gpt-5.6` to it.
5. Start the app with the probe preloaded. For a container, mount `memory-probe.cjs` read-only and
   set `NODE_OPTIONS=--require=/fixture/memory-probe.cjs`.

Do not point this fixture at a production Provider. The mock deliberately leaves every upstream
response open until the app or fixture closes it.

## Start The Mock

```bash
tests/load/issue-1408-replay-oom/start-mock-container.sh \
  cch1408-mock cch1408-network 31409 8
```

The command prints both URLs:

```text
stats=http://127.0.0.1:31409/stats
provider=http://cch1408-mock:3001
```

## Run A Wave Test

Store the test API key in a protected file outside the repository, then run:

```bash
export CCH_API_KEY_FILE=/path/to/test-api-key

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
CCH_SAMPLES=18
CCH_SAMPLE_INTERVAL_SECONDS=10
CCH_MOCK_MIB=8
```

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
- Redis remains running across its configured RDB save window and does not retain three copies of
  each multi-MiB response body.

The historical measurements and the exact evidence boundary are documented in
`docs/troubleshooting/issue-1408-replay-oom.md`.
