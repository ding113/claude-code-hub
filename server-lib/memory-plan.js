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
  const hotBudgetBytes = Math.min(budgetBytes, Math.floor(Math.max(0, ram - reserveBytes)));
  return { source: explicit ? "explicit" : "auto", budgetBytes, hotBudgetBytes, reserveBytes, weightedAvailableBytes, ...snapshot };
}

module.exports = { createMemoryPlan };
