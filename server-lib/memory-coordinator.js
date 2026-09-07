"use strict";

const { createMemoryPlan } = require("./memory-plan");
const { readResourceSnapshot } = require("./resource-snapshot");
const MESSAGE = "cch:memory-credit";

/** IPC 只传授权数。worker 身份由 cluster 连接确定，退出后才回收旧代授权。 */
function createMemoryCoordinator({ readSnapshot = readResourceSnapshot, env = process.env, log = () => {} } = {}) {
  let plan = createMemoryPlan({ env, snapshot: readSnapshot() });
  // worker 的 Next.js 基础堆尚未加载；所有 worker ready 前禁止发放正文额度。
  let target = 0;
  let granted = 0;
  let healthy = 0;
  let lastSwapIO = plan.swapIO || 0;
  let baselineReset = false;
  const clients = new Map();
  const snapshot = () => ({ ...plan, targetBytes: target, grantedBytes: granted, workers: clients.size, admissionReady: baselineReset });
  function sample() {
    if (!baselineReset) return snapshot();
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
    const state = { bytes: 0, requestId: 0, replyBytes: 0, releasedTotal: 0 };
    clients.set(worker, state);
    worker.on("message", (message) => {
      if (message?.type !== MESSAGE || !clients.has(worker)) return;
      const bytes = message.bytes;
      if (!Number.isSafeInteger(bytes) || bytes < 0) return;
      // 累计归还量也随下一次申请携带；归还消息丢失或重复都不会泄漏/重复释放额度。
      const releasedTotal = message.releasedTotal ?? state.releasedTotal;
      if (!Number.isSafeInteger(releasedTotal) || releasedTotal < state.releasedTotal || releasedTotal - state.releasedTotal > state.bytes) return;
      const released = releasedTotal - state.releasedTotal;
      state.bytes -= released; granted -= released; state.releasedTotal = releasedTotal;
      if (message.op === "acquire" && Number.isSafeInteger(message.id) && message.id > 0) {
        if (message.id < state.requestId) return;
        if (message.id > state.requestId) {
          state.requestId = message.id;
          state.replyBytes = Math.min(bytes, Math.max(0, target - granted));
          state.bytes += state.replyBytes; granted += state.replyBytes;
        }
        try {
          worker.send({ type: MESSAGE, id: message.id, bytes: state.replyBytes });
        } catch {
          // 同一申请 ID 重发相同结果；不重复发放，也不提前收回可能已送达的授权。
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
    const resource = readSnapshot();
    plan = createMemoryPlan({ env, snapshot: resource });
    lastSwapIO = resource.swapIO || 0;
    target = plan.hotBudgetBytes;
    log("info", "memory_plan_resolved", snapshot());
  }
  return { attach, sample, snapshot, resetBaseline };
}

module.exports = { createMemoryCoordinator, MEMORY_CREDIT_MESSAGE: MESSAGE };
