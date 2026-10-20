# MiniMax Provider Guide

Claude Code Hub routes MiniMax through its existing Anthropic-compatible and OpenAI-compatible provider types. Use **MiniMax-M3.1-Flash** first, with **MiniMax-M3** as the other current text model. Create separate provider entries for each protocol and region so routing and failover remain explicit.

## Endpoint Matrix

| Region | OpenAI-compatible base URL | Anthropic-compatible base URL |
| --- | --- | --- |
| Global | `https://api.minimax.io/v1` | `https://api.minimax.io/anthropic` |
| China | `https://api.minimaxi.com/v1` | `https://api.minimaxi.com/anthropic` |

Use the URLs exactly as shown. The OpenAI-compatible URL includes `/v1`. The Anthropic-compatible URL ends at `/anthropic`; Claude Code Hub appends the incoming `/v1/messages` path. Do not mix the two protocols. Keep your API key in the provider secret field.

## Provider Entries and Model Selection

Create a `claude` or `openai-compatible` provider entry for the protocol you use. The direct MiniMax model picker offers these IDs in order:

1. `MiniMax-M3.1-Flash`
2. `MiniMax-M3`

Both models have a 1,000,000-token context window and accept text, image, and video inputs. Set the provider's allowed model list to the exact IDs you intend to route. Existing explicit legacy selections and custom model redirect rules remain usable and editable; discovery filtering does not migrate saved configurations or rewrite request model names. Media models are unaffected.

For gateways, use their advertised IDs rather than the direct MiniMax IDs. Discovery retains verified routes such as OpenRouter's `minimax/minimax-m3.1-flash:free` and `minimax/minimax-m3`, or OpenCode's `minimax-m3.1-flash-free`. It does not manufacture a Flash route when the upstream catalog does not advertise one. The manual model input remains available for deliberate custom aliases.

## Thinking and Request Parameters

| Setting | MiniMax-M3.1-Flash | MiniMax-M3 |
| --- | --- | --- |
| Thinking | Always on; omit `thinking` or use `{"type":"adaptive"}` | Supports `adaptive` and `disabled` |
| Default thinking | On for both protocols | Off for Anthropic; on for OpenAI |
| Effort | `low`, `medium`, `high`, `xhigh`, `max`; default `max` | Flash effort tuning does not apply |
| Service tier | Unsupported; omit `service_tier` | `standard` or `priority` |

Flash rejects `thinking: {"type":"disabled"}` and effort `none`. Leave provider thinking overrides at their default when using Flash. Claude Code Hub forwards explicit client settings; it does not silently convert a request for disabled thinking into adaptive thinking.

For Anthropic requests, use `output_config.effort`. For OpenAI requests, use `reasoning_effort`; Flash does not support `reasoning_split: false`. Preserve complete assistant thinking blocks or `reasoning_content`, tool calls, and tool results in subsequent turns. Thinking tokens count toward the generation limit, so allow enough tokens for both reasoning and the final response.

Example Anthropic body sent to the hub's `/v1/messages` endpoint:

```json
{
  "model": "MiniMax-M3.1-Flash",
  "max_tokens": 4096,
  "output_config": { "effort": "max" },
  "messages": [{ "role": "user", "content": "Explain this function." }]
}
```

Example OpenAI body sent to the hub's `/v1/chat/completions` endpoint:

```json
{
  "model": "MiniMax-M3.1-Flash",
  "max_completion_tokens": 4096,
  "reasoning_effort": "max",
  "messages": [{ "role": "user", "content": "Explain this function." }]
}
```

Use the model-pricing settings and current provider prices for billing. Gateway prices and free-route availability can differ from the direct API.

## References

- [MiniMax models](https://platform.minimax.io/docs/guides/models-intro)
- [Anthropic API compatibility and thinking controls](https://platform.minimax.io/docs/api-reference/text-anthropic-api)
- [OpenAI API compatibility and thinking controls](https://platform.minimax.io/docs/api-reference/text-openai-api)
- [Current pricing](https://platform.minimax.io/docs/pricing/overview)
- [China API overview](https://platform.minimaxi.com/docs/api-reference/api-overview)
