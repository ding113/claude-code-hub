import type { BillingModelSource } from "@/types/system-config";

export interface ModelAuditDisplayInput {
  originalModel: string | null;
  model: string | null;
  actualResponseModel: string | null;
  billingModelSource: BillingModelSource | null | undefined;
}

export interface ModelAuditDisplay {
  /** 列表主显示列(对应现有"计费模型"语义,不改变 billingModelSource 的选择) */
  primaryBillingModel: string | null;
  /** originalModel -> model 之间的重定向是否存在 */
  hasRedirect: boolean;
  /** 响应实际模型是否与 effective request model(即 model,回退到 originalModel)不同 */
  hasActualMismatch: boolean;
  /** 列表二级灰色行要展示的真实响应模型;没有 mismatch 时为 null */
  secondaryActualModel: string | null;
  /** 详情面板是否拆成 "请求模型 / 响应模型" 两行;没有 mismatch 时为单行展示 */
  dialogShowsSplitFields: boolean;
  /** 详情面板"请求模型"行要用的值(即 model,回退到 originalModel) */
  effectiveRequestModel: string | null;
}

/**
 * 将 originalModel / model / actualResponseModel / billingModelSource 解析为一个统一的展示契约。
 *
 * 关键规则:
 * - **比较基准是 `model`(重定向后的 effective 请求模型),不是 `originalModel`**
 * - `primaryBillingModel` 仍然遵循现有 `billingModelSource` 决策,不被 actualResponseModel 影响
 * - 当 `actualResponseModel` 缺失或等于 `effectiveRequestModel` 时,一律不显示 mismatch 二级行 / tooltip
 */
export function resolveModelAuditDisplay(input: ModelAuditDisplayInput): ModelAuditDisplay {
  const effectiveRequestModel = input.model ?? input.originalModel;

  const primaryBillingModel =
    input.billingModelSource === "original"
      ? (input.originalModel ?? input.model)
      : (input.model ?? input.originalModel);

  const hasRedirect = Boolean(
    input.originalModel && input.model && input.originalModel !== input.model
  );

  const hasActualMismatch = Boolean(
    input.actualResponseModel &&
      effectiveRequestModel &&
      input.actualResponseModel !== effectiveRequestModel
  );

  return {
    primaryBillingModel,
    hasRedirect,
    hasActualMismatch,
    secondaryActualModel: hasActualMismatch ? input.actualResponseModel : null,
    dialogShowsSplitFields: hasActualMismatch,
    effectiveRequestModel,
  };
}
