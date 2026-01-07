/**
 * 特殊设置（通用审计字段）
 *
 * 用于记录请求在代理链路中发生的“特殊行为/特殊覆写”的命中与生效情况，
 * 便于在请求记录与请求详情中展示，支持后续扩展更多类型。
 */

export type SpecialSetting = ProviderParameterOverrideSpecialSetting;

export type SpecialSettingChangeValue = string | number | boolean | null;

export type ProviderParameterOverrideSpecialSetting = {
  type: "provider_parameter_override";
  scope: "provider";
  providerId: number | null;
  providerName: string | null;
  providerType: string | null;
  hit: boolean;
  changed: boolean;
  changes: Array<{
    path: string;
    before: SpecialSettingChangeValue;
    after: SpecialSettingChangeValue;
    changed: boolean;
  }>;
};
