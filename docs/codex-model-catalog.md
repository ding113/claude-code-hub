# Native Codex model catalog

CCH publishes complete native model metadata at authenticated
`GET /v1/models?client_version=...`. Ordinary OpenAI, Anthropic and Gemini
model lists, and explicit model-format overrides, retain their existing behavior.

## Client configuration

Keep inference and model discovery on the same CCH provider:

```toml
model_provider = "cch"

[model_providers.cch]
name = "cch"
base_url = "https://cch.example.com/v1"
model_catalog_url = "https://cch.example.com/v1/models"
wire_api = "responses"
env_key = "CCH_API_KEY"
```

Preserve the provider's existing authentication configuration when adding the catalog
URL. Codex sends the same provider credentials for inference and the catalog, and
adds its own `client_version`. Do not add format overrides to the catalog URL.
A CCH key does not necessarily authenticate directly to an upstream such as CPA.

## Discovery and permissions

CCH discovers `/models` beside each eligible Codex provider's Responses endpoint,
preserving gateway prefixes. Requests use that provider's key, configured proxy and
resolved custom headers. Redirects and client authorization forwarding are prohibited.

Only complete native entries are accepted. Ordinary OpenAI model IDs do not provide
enough information to reconstruct instructions, tools and reasoning capabilities.
Unknown extension fields are preserved. Exact aliases can use their redirect target's
metadata; pattern rules only filter concrete names.

Every response uses current database authentication, user/key permissions and provider
configuration, even when source metadata is cached or a conditional request matches.
Provider groups, schedules, client restrictions and model rules are applied before
publishing. Health, quotas and affinity do not make models disappear from the catalog.
Duplicate slugs select one complete source using group-effective priority and provider
ID; context limits use the smallest known values across eligible sources.

## Cache and failure behavior

The per-process cache is limited to 64 entries and 32 MiB. Redis shares at most 128
source variants. Cache identities include the provider, client version, actual outbound
headers and credential/configuration fingerprints; no credentials are placed in Redis
registry metadata or logs. Dynamic header variants do not share another caller's view.

Fresh snapshots last five minutes. Stale snapshots return immediately and refresh in
the background. Network errors, invalid responses and upstream 5xx retain the last
successful snapshot for at most 24 hours; failed attempts do not extend that period.
Upstream 401/403 revoke that provider's cached snapshots. A successful empty native
catalog replaces the previous snapshot.

Cold requests wait at most two seconds. If every eligible source is unavailable, CCH
returns HTTP 503 with `Retry-After: 1`, rather than presenting a fetch failure as a
successful empty catalog. No eligible providers, real empty source catalogs and
permission-filtered empty results remain successful empty catalogs.

Refreshes are deduplicated locally and with expiring, owner-checked Redis locks. The
background owner checks active static variants every 30 seconds. Dynamic header
variants refresh on demand. Redis operations have a separate 200 ms caller budget
and queue admission bound; a slow Redis connection cannot consume the client's full
catalog timeout. Scheduler shutdown stops new refreshes and cancels registered tasks.

Upstream reads are limited to 4 MiB. Final compact UTF-8 JSON is limited to 1 MiB;
oversized results return HTTP 502 with `PROXY_MODEL_CATALOG_TOO_LARGE`. Narrow provider
rules or user permissions rather than silently dropping models or instructions.

Codex 0.164.0 allows five seconds for the complete fetch and JSON decode. A fast first
byte or HTTP 200 is insufficient: validate the complete body from the actual client.
Complete native JSON responses declare their UTF-8 Content-Length and request reverse-proxy
buffering with X-Accel-Buffering, independently of streaming inference responses.
CCH emits a private content ETag and supports explicit conditional HTTP requests, but
Codex 0.164.0 must not be assumed to send conditional requests or reuse HTTP 304.

## Validation and rollback

```bash
bun run test:coverage:codex-model-catalog
```

Each new catalog module requires at least 80% line, statement, function and branch
coverage. Validate the actual Codex `model/list` output and visibility of models
permitted by the CCH key without sending inference requests. Logs report source/cache
states, counts, sizes and elapsed time.

Before deployment, preserve local changes and back up the running artifact,
configuration and a readable database archive. If catalog validation fails, restore
the previous CCH service configuration and the client's previously working model
catalog URL.
