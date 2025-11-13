# Redis Streams Integration Example

This document shows how Redis Streams will be integrated with the WebSocket system in upcoming tasks (IMPL-3, IMPL-4).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Next.js Instances                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │  Instance 1 │    │  Instance 2  │    │   Instance N    │  │
│  │             │    │              │    │                 │  │
│  │  ┌───────┐  │    │  ┌───────┐   │    │  ┌───────┐     │  │
│  │  │ WS    │  │    │  │ WS    │   │    │  │ WS    │     │  │
│  │  │Server │  │    │  │Server │   │    │  │Server │     │  │
│  │  └───┬───┘  │    │  └───┬───┘   │    │  └───┬───┘     │  │
│  │      │      │    │      │       │    │      │         │  │
│  │  ┌───▼──────▼────▼──────▼───────▼────▼──────▼───────┐ │  │
│  │  │     RedisStreamsClient (Singleton)                │ │  │
│  │  │  - subscribe("websocket-broadcast")               │ │  │
│  │  │  - publishMessage("websocket-broadcast", data)    │ │  │
│  │  └───────────────────────────────────────────────────┘ │  │
│  │                                                         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ Redis Streams
                               │ (XADD/XREAD)
                               ▼
                   ┌───────────────────────┐
                   │    Redis Server       │
                   │                       │
                   │  Stream:              │
                   │  - websocket-broadcast│
                   │  - session-updates    │
                   │  - metrics-updates    │
                   └───────────────────────┘
```

## Integration Steps (IMPL-3)

### 1. WebSocket Server with Redis Streams

**File**: `src/app/api/ws/route.ts` (to be created in IMPL-3)

```typescript
import { Server as SocketIOServer } from "socket.io";
import { getStreamsClient } from "@/lib/redis/streams";

export const runtime = "nodejs";

let io: SocketIOServer | null = null;

export async function SOCKET(
  client: WebSocketClient,
  request: IncomingMessage,
  server: WebSocketServer
) {
  // 初始化 socket.io 服务器 (仅一次)
  if (!io) {
    io = new SocketIOServer(server);

    // 订阅 Redis Streams 广播
    const streamsClient = getStreamsClient();
    await streamsClient.connect();

    await streamsClient.subscribe(
      "websocket-broadcast",
      async (message) => {
        const { event, data, rooms } = message.data;

        // 广播到所有客户端或指定 rooms
        if (rooms && rooms.length > 0) {
          rooms.forEach((room: string) => {
            io!.to(room).emit(event, data);
          });
        } else {
          io!.emit(event, data);
        }
      }
    );

    console.log("[WebSocket] Server initialized with Redis Streams");
  }

  // 处理客户端连接
  io.on("connection", (socket) => {
    console.log("[WebSocket] Client connected:", socket.id);

    // 加入房间 (基于用户权限)
    socket.on("join-room", (room: string) => {
      socket.join(room);
      console.log(`[WebSocket] ${socket.id} joined room: ${room}`);
    });

    socket.on("disconnect", () => {
      console.log("[WebSocket] Client disconnected:", socket.id);
    });
  });
}
```

### 2. Publishing Messages from Server Actions

**File**: `src/actions/active-sessions.ts` (to be modified in IMPL-4)

```typescript
import { getStreamsClient } from "@/lib/redis/streams";

// 原有的 Server Action
export async function createProxySession(userId: number, providerId: number) {
  // ... 创建 session 逻辑 ...

  // 发布 WebSocket 广播消息
  const streamsClient = getStreamsClient();
  await streamsClient.publishMessage("websocket-broadcast", {
    event: "session_created",
    data: {
      sessionId: session.id,
      userId,
      providerId,
      createdAt: Date.now(),
    },
    rooms: ["admin", `user-${userId}`], // 仅广播给 admin 和当前用户
  });

  return { ok: true, data: session };
}
```

### 3. Real-time Metrics Broadcasting

**File**: `src/lib/proxy-status-tracker.ts` (to be modified in IMPL-4)

```typescript
import { getStreamsClient } from "@/lib/redis/streams";

export class ProxyStatusTracker {
  // ... 现有代码 ...

  public startRequest(userId: number, providerId: number): void {
    // 更新内存计数
    this.updateMetrics(userId, providerId, 1);

    // 广播实时更新
    const streamsClient = getStreamsClient();
    streamsClient.publishMessage("websocket-broadcast", {
      event: "metrics_update",
      data: {
        userId,
        providerId,
        activeSessions: this.getActiveSessions(userId),
        timestamp: Date.now(),
      },
      rooms: ["admin", `user-${userId}`],
    }).catch(err => {
      logger.error("[ProxyStatusTracker] Failed to broadcast metrics:", err);
      // Fail Open: 不阻塞主逻辑
    });
  }

  // ... 其他方法 ...
}
```

## Message Format Standards

### Event Types

```typescript
// 定义统一的 WebSocket 事件类型
type WebSocketEvent =
  | "session_created"
  | "session_ended"
  | "metrics_update"
  | "provider_status_change"
  | "usage_log_added";

interface WebSocketMessage {
  event: WebSocketEvent;
  data: unknown;
  rooms?: string[]; // 可选的 room 列表，用于权限隔离
}
```

### Example Messages

#### Session Created

```json
{
  "event": "session_created",
  "data": {
    "sessionId": "abc123",
    "userId": 456,
    "providerId": 789,
    "model": "claude-sonnet-4-5-20250929",
    "createdAt": 1234567890123
  },
  "rooms": ["admin", "user-456"]
}
```

#### Metrics Update

```json
{
  "event": "metrics_update",
  "data": {
    "userId": 456,
    "activeSessions": 3,
    "totalRequests": 1024,
    "totalCost": 15.67,
    "timestamp": 1234567890123
  },
  "rooms": ["admin", "user-456"]
}
```

#### Provider Status Change

```json
{
  "event": "provider_status_change",
  "data": {
    "providerId": 789,
    "status": "degraded",
    "circuitState": "half_open",
    "failureCount": 3,
    "timestamp": 1234567890123
  },
  "rooms": ["admin"]
}
```

## Client-Side Integration (IMPL-5)

**File**: `src/components/customs/overview-panel.tsx` (to be modified in IMPL-5)

```typescript
"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

export function OverviewPanel({ isAdmin }: { isAdmin: boolean }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [metrics, setMetrics] = useState({
    activeSessions: 0,
    totalRequests: 0,
    totalCost: 0,
  });

  // WebSocket 连接
  useEffect(() => {
    const newSocket = io({ path: "/api/ws" });

    newSocket.on("connect", () => {
      console.log("[WebSocket] Connected");

      // 加入管理员房间
      if (isAdmin) {
        newSocket.emit("join-room", "admin");
      }
    });

    newSocket.on("metrics_update", (data) => {
      setMetrics(prev => ({
        ...prev,
        ...data,
      }));
    });

    newSocket.on("disconnect", () => {
      console.log("[WebSocket] Disconnected");
      // 降级到轮询
      startPolling();
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [isAdmin]);

  // 降级轮询 (WebSocket 不可用时)
  const startPolling = () => {
    const interval = setInterval(async () => {
      const response = await fetch("/api/overview");
      const data = await response.json();
      setMetrics(data);
    }, 5000);

    return () => clearInterval(interval);
  };

  return (
    <div>
      <p>Active Sessions: {metrics.activeSessions}</p>
      <p>Total Requests: {metrics.totalRequests}</p>
      <p>Total Cost: ${metrics.totalCost.toFixed(2)}</p>
    </div>
  );
}
```

## Performance Considerations

### 1. Message Frequency Throttling

```typescript
import { throttle } from "lodash";

const broadcastMetrics = throttle(
  async (data) => {
    await streamsClient.publishMessage("websocket-broadcast", {
      event: "metrics_update",
      data,
    });
  },
  1000, // 最多每秒广播 1 次
  { leading: true, trailing: true }
);
```

### 2. Message Batching

```typescript
// 批量发布多个事件
const events = [
  { event: "session_created", data: { ... } },
  { event: "metrics_update", data: { ... } },
];

await Promise.all(
  events.map(evt =>
    streamsClient.publishMessage("websocket-broadcast", evt)
  )
);
```

### 3. Room-Based Filtering

```typescript
// 只广播给特定用户
await streamsClient.publishMessage("websocket-broadcast", {
  event: "session_update",
  data: { ... },
  rooms: [`user-${userId}`], // 仅该用户收到
});

// 只广播给管理员
await streamsClient.publishMessage("websocket-broadcast", {
  event: "provider_alert",
  data: { ... },
  rooms: ["admin"],
});
```

## Error Handling and Fallback

### 1. Redis Streams Unavailable

```typescript
const streamsClient = getStreamsClient();

// 发布消息（带降级）
const published = await streamsClient.publishMessage("websocket-broadcast", data);

if (!published) {
  // Fail Open: Redis 不可用，记录日志但不阻塞
  logger.warn("[WebSocket] Redis Streams unavailable, message not broadcasted");

  // 可选：使用本地事件发射器作为降级
  localEmitter.emit("metrics_update", data);
}
```

### 2. WebSocket Connection Failed

```typescript
// 客户端自动降级到轮询
socket.on("connect_error", () => {
  console.warn("[WebSocket] Connection failed, falling back to polling");
  setIsPolling(true);
});

socket.on("connect", () => {
  console.log("[WebSocket] Connected, disabling polling");
  setIsPolling(false);
});
```

## Testing Strategy

### 1. Unit Tests (streams.test.ts)

- ✅ 已完成：消息发布和订阅
- ✅ 已完成：消费组管理
- ✅ 已完成：错误处理和 Fail Open

### 2. Integration Tests (IMPL-3)

- WebSocket 服务器初始化
- Redis Streams 订阅和广播
- 多客户端消息分发

### 3. End-to-End Tests (IMPL-5)

- 前端 WebSocket 连接
- 实时数据更新
- 降级到轮询

## Next Steps

1. **IMPL-3**: 创建 socket.io WebSocket 服务器，集成 RedisStreamsClient
2. **IMPL-4**: 修改 Server Actions 和 ProxyStatusTracker 发布实时消息
3. **IMPL-5**: 迁移前端组件到 WebSocket，保留轮询降级

## References

- Redis Streams 客户端实现: `src/lib/redis/streams.ts`
- 类型定义: `src/types/redis-streams.ts`
- 使用文档: `src/lib/redis/README-STREAMS.md`
- 任务规格: `.workflow/WFS-websocket-realtime-push-dashboard-messages-session/.task/IMPL-2.json`
