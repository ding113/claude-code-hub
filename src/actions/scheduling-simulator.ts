"use server";

import type { ActionResult } from "@/actions/types";
import { getSession } from "@/lib/auth";
import {
  type SchedulingSimulationInput,
  type SchedulingSimulationResult,
  simulateProviderScheduling,
} from "@/lib/scheduling-simulator";
import { findAllProviders } from "@/repository/provider";

/**
 * Server action: 模拟供应商调度决策链
 *
 * 管理员专用功能，模拟一个请求经过完整调度链后的供应商选择过程。
 */
export async function simulateSchedulingAction(
  input: SchedulingSimulationInput
): Promise<ActionResult<SchedulingSimulationResult>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "Unauthorized" };
    }

    if (!input.format || !input.model?.trim()) {
      return { ok: false, error: "Format and model are required" };
    }

    const providers = await findAllProviders();
    const result = await simulateProviderScheduling(input, providers);

    return { ok: true, data: result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Simulation failed",
    };
  }
}
