# Error Session ID Guide

When reporting an API error, include the CCH session id so maintainers can locate the exact request.

## Where to find it

1. **Preferred**: response header `x-cch-session-id`
2. **Fallback**: `error.message` suffix `cch_session_id: <id>`

If the response does not include a session id, the server could not determine it for that request.

## Example (curl)

```bash
curl -i -sS \\
  -H "Authorization: Bearer <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4.1-mini","messages":[{"role":"user","content":"hi"}]}' \\
  http://localhost:13500/v1/chat/completions
```

In the response:

- Check header: `x-cch-session-id: ...`
- If missing, check JSON: `{"error":{"message":"... (cch_session_id: ...)"} }`

