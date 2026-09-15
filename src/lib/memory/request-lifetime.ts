import { AsyncLocalStorage } from "node:async_hooks";
import type { MemoryLease } from "./governor";

/** 响应与后台消费者共同拥有请求分配；取消不等同于消费者已退出。 */
class RequestMemoryLifetime {
  private owners = 1;
  private leases = new Set<MemoryLease>();

  add(lease: MemoryLease): void {
    if (this.owners === 0) throw new Error("Request memory lifetime already ended");
    this.leases.add(lease);
  }

  retain(): () => void {
    if (this.owners === 0) return () => {};
    this.owners++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  release(): void {
    if (this.owners === 0 || --this.owners !== 0) return;
    for (const lease of this.leases) lease.release();
    this.leases.clear();
  }
}

const storageKey = Symbol.for("cch.requestMemoryLifetime");
const globals = globalThis as typeof globalThis & {
  [storageKey]?: AsyncLocalStorage<RequestMemoryLifetime>;
};
const storage = (globals[storageKey] ??= new AsyncLocalStorage<RequestMemoryLifetime>());
const abandonedResponses = new FinalizationRegistry<() => void>((release) => release());

/** 返回 false 的独立调用方仍可使用 GC 兜底；HTTP 入口总有明确所有者。 */
export function attachRequestMemory(lease: MemoryLease): boolean {
  const lifetime = storage.getStore();
  if (!lifetime) return false;
  lifetime.add(lease);
  return true;
}

/** 在后台任务实际结束时调用；不能在只发出 abort 时归还。 */
export function retainCurrentRequestMemory(): () => void {
  return storage.getStore()?.retain() ?? (() => {});
}

export function retainRequestMemoryUntil<T>(promise: Promise<T>): Promise<T> {
  return promise.finally(retainCurrentRequestMemory());
}

/** EOF、读错、取消和无正文响应均确定性释放根所有者，无需触发 V8 GC。 */
function responseOwner(lifetime: RequestMemoryLifetime) {
  const token = {};
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    abandonedResponses.unregister(token);
    lifetime.release();
  };
  return { token, release };
}

export async function withRequestMemoryLifetime(
  operation: () => Promise<Response>
): Promise<Response> {
  const lifetime = new RequestMemoryLifetime();
  const { token, release } = responseOwner(lifetime);
  return storage.run(lifetime, async () => {
    try {
      const response = await operation();
      if (!response.body) {
        release();
        return response;
      }
      const reader = response.body.getReader();
      const wrapped = new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              return storage.run(lifetime, async () => {
                try {
                  const result = await reader.read();
                  if (result.done) {
                    reader.releaseLock();
                    release();
                    controller.close();
                  } else controller.enqueue(result.value);
                } catch (error) {
                  reader.releaseLock();
                  release();
                  controller.error(error);
                }
              });
            },
            cancel(reason) {
              return storage.run(lifetime, async () => {
                try {
                  await reader.cancel(reason);
                } finally {
                  reader.releaseLock();
                  release();
                }
              });
            },
          },
          { highWaterMark: 0 }
        ),
        { status: response.status, statusText: response.statusText, headers: response.headers }
      );
      // 框架可能仅转交 body 并重建 Response；GC 兜底必须跟随仍被读取的流。
      abandonedResponses.register(wrapped.body!, release, token);
      return wrapped;
    } catch (error) {
      release();
      throw error;
    }
  });
}
