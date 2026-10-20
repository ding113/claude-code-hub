"use strict";

const { readResourceSnapshot } = require("./resource-snapshot");
const MiB = 1024 * 1024;

function createMemoryPlan({ env = process.env, snapshot = readResourceSnapshot() } = {}) {
  const ram = Math.max(0, snapshot.availableRamBytes);
  const weightedAvailableBytes = ram + Math.max(0, snapshot.availableSwapBytes) * 0.5;
  const raw = env.CCH_MEMORY_BUDGET_BYTES;
  const explicit = raw != null && String(raw).trim() !== "" && String(raw).trim() !== "auto";
  const reserveBytes = explicit ? ram * 0.1 : Math.max(256 * MiB, ram * 0.1);
  if (explicit && (!Number.isSafeInteger(Number(raw)) || Number(raw) <= 0)) {
    throw new Error("CCH_MEMORY_BUDGET_BYTES must be auto or a positive integer");
  }
  const autoBudget = Math.floor(0.6 * Math.max(0, weightedAvailableBytes - reserveBytes));
  const budgetBytes = explicit ? Number(raw) : autoBudget;
  // 总量已按加权余量乘 0.60。热点再受真实物理余量约束，不能重复折扣掉 swap 的贡献。
  // 运行时只用真实物理余量收紧上限；0.60 折扣已体现在启动基线里，不能随进程自身 RSS 重复折扣。
  const headroomBytes = Math.floor(Math.max(0, ram - reserveBytes));
  const hotBudgetBytes = Math.min(budgetBytes, headroomBytes);
  return { source: explicit ? "explicit" : "auto", budgetBytes, hotBudgetBytes, headroomBytes, reserveBytes, weightedAvailableBytes, ...snapshot };
}

module.exports = { createMemoryPlan };
