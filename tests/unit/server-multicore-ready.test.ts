import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireFromHere = createRequire(import.meta.url);
const { notifyMulticoreReady } = requireFromHere("../../server.js") as {
  notifyMulticoreReady: () => void;
};
const { WORKER_READY_MESSAGE_TYPE } = requireFromHere("../../server-lib/multicore.js") as {
  WORKER_READY_MESSAGE_TYPE: string;
};

const originalSend = process.send;

afterEach(() => {
  if (originalSend) {
    process.send = originalSend;
  } else {
    delete process.send;
  }
  delete process.env.CCH_MULTICORE_ACTIVE;
  delete process.env.CCH_MULTICORE_WORKER_INDEX;
  vi.restoreAllMocks();
});

describe("multicore worker readiness message", () => {
  it("sends only tiny identity metadata after a clustered worker is listening", () => {
    const send = vi.fn();
    process.send = send as typeof process.send;
    process.env.CCH_MULTICORE_ACTIVE = "1";
    process.env.CCH_MULTICORE_WORKER_INDEX = "2";

    notifyMulticoreReady();

    expect(send).toHaveBeenCalledWith({
      type: WORKER_READY_MESSAGE_TYPE,
      workerIndex: 2,
      pid: process.pid,
    });
  });

  it("does not use IPC in standalone mode", () => {
    const send = vi.fn();
    process.send = send as typeof process.send;
    notifyMulticoreReady();
    expect(send).not.toHaveBeenCalled();
  });
});
