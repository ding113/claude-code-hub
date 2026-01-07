"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

export interface UserEditTranslations {
  sections: {
    basicInfo: string;
    expireTime: string;
    limitRules: string;
    accessRestrictions: string;
  };
  fields: {
    username: {
      label: string;
      placeholder: string;
    };
    description: {
      label: string;
      placeholder: string;
    };
    tags: {
      label: string;
      placeholder: string;
    };
    providerGroup?: {
      label: string;
      placeholder: string;
      providersSuffix?: string;
      tagInputErrors?: {
        empty?: string;
        duplicate?: string;
        too_long?: string;
        invalid_format?: string;
        max_tags?: string;
      };
      errors?: {
        loadFailed?: string;
      };
    };
    enableStatus: {
      label: string;
      enabledDescription: string;
      disabledDescription: string;
      confirmEnable: string;
      confirmDisable: string;
      confirmEnableTitle: string;
      confirmDisableTitle: string;
      confirmEnableDescription: string;
      confirmDisableDescription: string;
      cancel: string;
      processing: string;
    };
    allowedClients: {
      label: string;
      description: string;
      customLabel: string;
      customPlaceholder: string;
    };
    allowedModels: {
      label: string;
      placeholder: string;
      description: string;
    };
  };
  presetClients: {
    "claude-cli": string;
    "gemini-cli": string;
    "factory-cli": string;
    "codex-cli": string;
  };
  limitRules: {
    addRule: string;
    ruleTypes: {
      limitRpm: string;
      limit5h: string;
      limitDaily: string;
      limitWeekly: string;
      limitMonthly: string;
      limitTotal: string;
      limitSessions: string;
    };
    quickValues: {
      unlimited: string;
      "10": string;
      "50": string;
      "100": string;
      "500": string;
    };
  };
  quickExpire: {
    week: string;
    month: string;
    threeMonths: string;
    year: string;
  };
}

export interface UseUserTranslationsOptions {
  showProviderGroup?: boolean;
}

/**
 * Hook to build user edit section translations.
 * Centralizes all translation key lookups for UserEditSection.
 */
export function useUserTranslations(
  options: UseUserTranslationsOptions = {}
): UserEditTranslations {
  const { showProviderGroup = false } = options;
  const t = useTranslations("dashboard.userManagement");
  const tUi = useTranslations("ui.tagInput");

  return useMemo(() => {
    return {
      sections: {
        basicInfo: t("userEditSection.sections.basicInfo"),
        expireTime: t("userEditSection.sections.expireTime"),
        limitRules: t("userEditSection.sections.limitRules"),
        accessRestrictions: t("userEditSection.sections.accessRestrictions"),
      },
      fields: {
        username: {
          label: t("userEditSection.fields.username.label"),
          placeholder: t("userEditSection.fields.username.placeholder"),
        },
        description: {
          label: t("userEditSection.fields.description.label"),
          placeholder: t("userEditSection.fields.description.placeholder"),
        },
        tags: {
          label: t("userEditSection.fields.tags.label"),
          placeholder: t("userEditSection.fields.tags.placeholder"),
        },
        providerGroup: showProviderGroup
          ? {
              label: t("userEditSection.fields.providerGroup.label"),
              placeholder: t("userEditSection.fields.providerGroup.placeholder"),
              providersSuffix: t("providerGroupSelect.providersSuffix"),
              tagInputErrors: {
                empty: tUi("emptyTag"),
                duplicate: tUi("duplicateTag"),
                too_long: tUi("tooLong", { max: 50 }),
                invalid_format: tUi("invalidFormat"),
                max_tags: tUi("maxTags"),
              },
              errors: {
                loadFailed: t("providerGroupSelect.loadFailed"),
              },
            }
          : undefined,
        enableStatus: {
          label: t("userEditSection.fields.enableStatus.label"),
          enabledDescription: t("userEditSection.fields.enableStatus.enabledDescription"),
          disabledDescription: t("userEditSection.fields.enableStatus.disabledDescription"),
          confirmEnable: t("userEditSection.fields.enableStatus.confirmEnable"),
          confirmDisable: t("userEditSection.fields.enableStatus.confirmDisable"),
          confirmEnableTitle: t("userEditSection.fields.enableStatus.confirmEnableTitle"),
          confirmDisableTitle: t("userEditSection.fields.enableStatus.confirmDisableTitle"),
          confirmEnableDescription: t(
            "userEditSection.fields.enableStatus.confirmEnableDescription"
          ),
          confirmDisableDescription: t(
            "userEditSection.fields.enableStatus.confirmDisableDescription"
          ),
          cancel: t("userEditSection.fields.enableStatus.cancel"),
          processing: t("userEditSection.fields.enableStatus.processing"),
        },
        allowedClients: {
          label: t("userEditSection.fields.allowedClients.label"),
          description: t("userEditSection.fields.allowedClients.description"),
          customLabel: t("userEditSection.fields.allowedClients.customLabel"),
          customPlaceholder: t("userEditSection.fields.allowedClients.customPlaceholder"),
        },
        allowedModels: {
          label: t("userEditSection.fields.allowedModels.label"),
          placeholder: t("userEditSection.fields.allowedModels.placeholder"),
          description: t("userEditSection.fields.allowedModels.description"),
        },
      },
      presetClients: {
        "claude-cli": t("userEditSection.presetClients.claude-cli"),
        "gemini-cli": t("userEditSection.presetClients.gemini-cli"),
        "factory-cli": t("userEditSection.presetClients.factory-cli"),
        "codex-cli": t("userEditSection.presetClients.codex-cli"),
      },
      limitRules: {
        addRule: t("limitRules.addRule"),
        ruleTypes: {
          limitRpm: t("limitRules.ruleTypes.limitRpm"),
          limit5h: t("limitRules.ruleTypes.limit5h"),
          limitDaily: t("limitRules.ruleTypes.limitDaily"),
          limitWeekly: t("limitRules.ruleTypes.limitWeekly"),
          limitMonthly: t("limitRules.ruleTypes.limitMonthly"),
          limitTotal: t("limitRules.ruleTypes.limitTotal"),
          limitSessions: t("limitRules.ruleTypes.limitSessions"),
        },
        quickValues: {
          unlimited: t("limitRules.quickValues.unlimited"),
          "10": t("limitRules.quickValues.10"),
          "50": t("limitRules.quickValues.50"),
          "100": t("limitRules.quickValues.100"),
          "500": t("limitRules.quickValues.500"),
        },
      },
      quickExpire: {
        week: t("quickExpire.oneWeek"),
        month: t("quickExpire.oneMonth"),
        threeMonths: t("quickExpire.threeMonths"),
        year: t("quickExpire.oneYear"),
      },
    };
  }, [t, tUi, showProviderGroup]);
}
