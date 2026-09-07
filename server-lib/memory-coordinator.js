"use strict";

const { createMemoryPlan } = require("./memory-plan");
const { readResourceSnapshot } = require("./resource-snapshot");
const MESSAGE = "cch:memory-credit";

/** IPC 只传授权数。worker 身份由 cluster 连接确定，退出后才回收旧代授权。 */
function createMemoryCoordinator({ readSnapshot = readResourceSnapshot, env = process.env, log = () => {} } = {}) {
  let plan = createMemoryPlan({ env, snapshot: readSnapshot() });
  let target = plan.hotBudgetBytes;
  let granted = 0;
  let healthy = 0;
  let lastSwapIO = plan.swapIO || 0;
  let baselineReset = false;
  const clients = new Map();
  const snapshot = () => ({ ...plan, targetBytes: target, grantedBytes: granted, workers: clients.size });
  function sample() {
    const resource = readSnapshot();
    const current = createMemoryPlan({ env, snapshot: resource });
    const pressure = resource.memoryPressure >= 1 || (resource.swapIO || 0) > lastSwapIO;
    lastSwapIO = resource.swapIO || 0;
    // 加回仍在账上的在用量只用于计算剩余可授权空间；启动上限始终不变。
    const safe = Math.min(plan.hotBudgetBytes, granted + current.hotBudgetBytes);
    if (pressure || safe < target) {
      target = pressure ? Math.min(safe, Math.floor(target * 0.8)) : safe;
      healthy = 0;
    } else if (++healthy >= 10) {
      target = Math.min(safe, target + Math.max(1024 * 1024, Math.floor(plan.hotBudgetBytes * 0.01)));
      healthy = 0;
    }
    return snapshot();
  }
  function attach(worker) {
    const state = { bytes: 0 };
    clients.set(worker, state);
    worker.on("message", (message) => {
      if (message?.type !== MESSAGE || !clients.has(worker)) return;
      const bytes = message.bytes;
      if (!Number.isSafeInteger(bytes) || bytes < 0) return;
      if (message.op === "release") {
        const released = Math.min(bytes, state.bytes);
        state.bytes -= released;
        granted -= released;
      } else if (message.op === "acquire" && Number.isSafeInteger(message.id)) {
        const accepted = bytes <= target - granted;
        if (accepted) { state.bytes += bytes; granted += bytes; }
        try {
          worker.send({ type: MESSAGE, id: message.id, bytes: accepted ? bytes : 0 });
        } catch {
          // 发送失败仍保留授权，等待 exit；不能假定子进程没有收到消息。
        }
      }
    });
    worker.once("exit", () => {
      if (!clients.delete(worker)) return;
      granted -= state.bytes;
    });
  }
  function resetBaseline() {
    // 仅允许启动完成时更新一次基线；有流量时不能重复把空闲容量当成新增预算。
    if (baselineReset) return;
    baselineReset = true;
    plan = createMemoryPlan({ env, snapshot: readSnapshot() });
    target = plan.hotBudgetBytes;
    log("info", "memory_plan_resolved", snapshot());
  }
  return { attach, sample, snapshot, resetBaseline };
}

module.exports = { createMemoryCoordinator, MEMORY_CREDIT_MESSAGE: MESSAGE };
