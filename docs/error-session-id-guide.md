# Error Session ID Guide

When reporting an API error, include the CCH session id so maintainers can locate the exact request.

## Where to find it

1. **Primary**: JSON `error.message` suffix `cch_session_id: <id>`
2. **Note**: proxy 不再返回 `x-cch-session-id` response header

If the response does not include a session id suffix, the server either could not determine it for that
request, or the error response did not normalize into a JSON `error.message` envelope.

## Example (curl)

```bash
curl -i -sS \\
  -H "Authorization: Bearer <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4.1-mini","messages":[{"role":"user","content":"hi"}]}' \\
  http://localhost:13500/v1/chat/completions
```

In the response:

- Check JSON: `{"error":{"message":"... (cch_session_id: ...)"} }`
- Do not expect `x-cch-session-id` header from the proxy anymore
