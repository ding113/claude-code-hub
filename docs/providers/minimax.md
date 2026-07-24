# MiniMax Provider Guide

Claude Code Hub can route MiniMax models through its existing Anthropic-compatible and OpenAI-compatible provider types. Create separate provider entries for each protocol and region so that routing and failover remain explicit.

## Endpoint Matrix

| Region | OpenAI-compatible base URL | Anthropic-compatible base URL |
| --- | --- | --- |
| Global | `https://api.minimax.io/v1` | `https://api.minimax.io/anthropic` |
| China | `https://api.minimaxi.com/v1` | `https://api.minimaxi.com/anthropic` |

Use the URLs exactly as shown. The OpenAI-compatible URL includes `/v1`. The Anthropic-compatible URL ends at `/anthropic`; do not append `/v1`. Claude Code Hub appends the request path, including `/v1/messages`, when forwarding an Anthropic request.

Official documentation:

- Global: https://platform.minimax.io/docs/api-reference/api-overview
- China: https://platform.minimaxi.com/docs/api-reference/api-overview

## Provider Entries

Create one `claude` provider entry and one `openai-compatible` provider entry for each region. Set the provider URL to the matching value from the endpoint matrix and set the provider's allowed model list to the exact model IDs below.

Do not reuse an OpenAI-compatible URL for an Anthropic provider entry or an Anthropic-compatible URL for an OpenAI-compatible entry. Keep the API key in the provider secret field and never place it in documentation or model redirect rules.

## Model Catalog

Prices are in USD per one million tokens.

### MiniMax-M3

- Context window: `1,000,000` tokens
- Input modalities: text, image, and video
- Thinking: adaptive or disabled
- Standard tier, up to `512,000` input tokens: input `$0.30`, output `$1.20`, cache read `$0.06`
- Standard tier, above `512,000` input tokens: input `$0.60`, output `$2.40`, cache read `$0.12`
- Priority tier, up to `512,000` input tokens: input `$0.45`, output `$1.80`, cache read `$0.09`
- Priority tier, above `512,000` input tokens: input `$0.90`, output `$3.60`, cache read `$0.18`
- Cache write pricing: not specified

### MiniMax-M2.7

- Context window: `204,800` tokens
- Input modalities: text
- Thinking: always on
- Input: `$0.30`
- Output: `$1.20`
- Cache read: `$0.06`
- Cache write: `$0.375`

## Request Routing

Use `MiniMax-M3` or `MiniMax-M2.7` as the requested model ID. If the provider's allowed model list is configured, use exact-match entries for both IDs and keep both models available for routing. Existing model redirect rules can still map an application-specific name to either target model without changing the upstream provider URL.
