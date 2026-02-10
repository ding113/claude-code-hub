# Troubleshooting Guide: Provider Endpoint Issues (Issue #742)

This guide addresses issues related to provider endpoint updates, disappearances, and the "dual JSON" response format observed in network logs.

## 1. Understanding "Dual JSON" Responses (React Flight Protocol)

Users may observe network responses containing multiple JSON-like structures or lines starting with `0:`, `1:`, etc. This is **expected behavior** for Next.js Server Actions using the React Flight protocol.

### What is React Flight?
React Flight is the underlying protocol used by React Server Components (RSC) and Server Actions to stream UI updates and data from the server to the client.

### Example Response Format
A typical Server Action response might look like this in the raw response tab:

```text
0:["$@1",["$","div",null,{"children":"..."}]]
1:{"ok":true,"data":{...}}
```

- **Line `0:`**: Often contains UI updates, revalidated path data, or serialized component trees (RSC payload).
- **Line `1:`**: Contains the actual return value of the Server Action (e.g., your `ok: true` or `error` object).

### Why it looks like "Two JSONs"
When inspecting the response in browser DevTools:
1. **Preview Tab**: May only show the parsed result of the last chunk or a merged object, which can be confusing.
2. **Response Tab**: Shows the raw stream with multiple lines.

**Conclusion**: This is not a bug in the API logic but the transport protocol of Next.js. Focus on the `1:` (or subsequent) lines for the actual business logic result.

## 2. Issue: Endpoint Updates Not Persisting ("Success but no change")

### Symptoms
- User edits an endpoint URL.
- UI shows a success toast.
- The URL reverts to the old value after refresh or re-opening the dialog.

### Root Cause
A unique constraint violation (e.g., duplicate URL for the same vendor/type) was occurring, but the generic error handler masked it as a "successful" operation in some UI paths, or a silent failure occurred where the cache wasn't updated.

### Resolution (Fix #742)
- **Stable Error Codes**: The backend now returns deterministic error codes (e.g., `PROVIDER_ENDPOINT_CONFLICT`) instead of generic failures.
- **Read-After-Write Consistency**: The update action now explicitly verifies the written value matches the requested value before returning success.
- **UI Feedback**: The frontend now displays specific error messages for conflicts and only shows "Success" when the data is truly persisted.

## 3. Issue: Sibling Endpoints Disappearing

### Symptoms
- Editing a Provider (e.g., changing the main API Key or unrelated field) causes secondary Endpoints (e.g., a custom model endpoint) to disappear from the list.

### Root Cause
The `syncProviderEndpointOnProviderEdit` logic was overly aggressive. It treated "endpoints not matching the new URL" as "obsolete" and soft-deleted them, even if they were distinct endpoints meant to exist alongside the main one.

### Resolution (Fix #742)
- **Conservative Sync Strategy**: The sync logic now defaults to *keeping* sibling endpoints unless explicitly replaced.
- **Soft-Delete Alignment**: We aligned the unique constraints to ignore soft-deleted rows, preventing "zombie" rows from blocking active endpoint creation/updates.

## 4. How to Verify Fixes

### 1. Direct Endpoint Edit
- **Action**: Edit an endpoint URL to a value that already exists (active) for the same vendor.
- **Expected**: Error toast "Endpoint conflict" (or similar), *not* success.
- **Action**: Edit an endpoint URL to a new valid value.
- **Expected**: Success toast, and the new value persists after refresh.

### 2. Provider Edit Sync
- **Pre-condition**: Have a Provider with URL A and a separate Endpoint with URL B under the same vendor.
- **Action**: Edit the Provider's URL from A to C.
- **Expected**:
    - Provider URL updates to C.
    - Endpoint with URL B *remains* visible and active (is not deleted).

## 5. Data Repair (Dry-Run)

If you suspect data loss (missing endpoints) from previous versions:

Run the repair tool in dry-run mode (integration test):
```bash
bunx vitest run tests/integration/provider-endpoint-index-and-repair.test.ts -t "dry-run"
```
This will report any active Providers that are missing a corresponding active Endpoint, categorized by risk.
