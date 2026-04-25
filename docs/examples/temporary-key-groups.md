# Temporary Key Groups API Examples

These examples use the `/api/actions/*` endpoints. Authenticate with an admin token or an
admin session cookie.

## Public Status

No auth is required for public status.

```bash
curl -sS http://localhost:23000/api/system-status
curl -sS http://localhost:23000/api/status
```

## Create A Temporary Key Group

`baseKeyId` must belong to `userId`. The created keys inherit routing and limits from the base
key. The group name is derived from the user's provider group.

```bash
curl -sS -X POST http://localhost:23000/api/actions/keys/createTemporaryKeysBatch \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -d '{
    "userId": 10,
    "baseKeyId": 100,
    "count": 5,
    "customLimitTotalUsd": 20
  }'
```

## Download A Temporary Key Group

The response data is plain text with one key per line.

```bash
curl -sS -X POST http://localhost:23000/api/actions/keys/downloadTemporaryKeyGroup \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -d '{
    "userId": 10,
    "groupName": "default"
  }'
```

## Remove A Temporary Key Group

The action refuses to remove the group if it would delete the user's last enabled key.

```bash
curl -sS -X POST http://localhost:23000/api/actions/keys/removeTemporaryKeyGroup \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -d '{
    "userId": 10,
    "groupName": "default"
  }'
```

## Sync User Limits To Keys

This saves the user fields and distributes user-level limits across all undeleted keys for that
user.

```bash
curl -sS -X POST http://localhost:23000/api/actions/users/syncUserConfigToKeys \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -d '{
    "userId": 10,
    "dailyQuota": 100,
    "limitTotalUsd": 900,
    "limitConcurrentSessions": 3,
    "providerGroup": "default",
    "dailyResetMode": "rolling",
    "dailyResetTime": "18:30"
  }'
```
