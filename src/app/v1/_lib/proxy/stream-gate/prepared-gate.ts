import type { StreamGatePrebufferLease } from "./prebuffer-budget";

type Owner = { lease: StreamGatePrebufferLease | null };
const owners = new WeakMap<Response, Owner>();
const abandoned = new FinalizationRegistry<Owner>((owner) => owner.lease?.release());

/** 在发起上游前取得的工作集，随响应转移；非 SSE、异常状态和取消也有释放路径。 */
export function prepareGateResponse(response: Response, lease: StreamGatePrebufferLease): Response {
  if (!response.body) {
    lease.release();
    return response;
  }
  const reader = response.body.getReader();
  const owner: Owner = { lease };
  const release = () => {
    owner.lease?.release();
    owner.lease = null;
  };
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            release();
            controller.close();
          } else controller.enqueue(value);
        } catch (error) {
          release();
          controller.error(error);
        }
      },
      cancel(reason) {
        release();
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 }
  );
  abandoned.register(body, owner);
  const prepared = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  owners.set(prepared, owner);
  return prepared;
}

export function takePreparedGateLease(response: Response): StreamGatePrebufferLease | undefined {
  const owner = owners.get(response);
  if (!owner) return undefined;
  owners.delete(response);
  const lease = owner.lease;
  owner.lease = null;
  return lease ?? undefined;
}
