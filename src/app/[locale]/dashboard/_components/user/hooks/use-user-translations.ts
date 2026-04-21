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
      customHelp: string;
    };
    blockedClients: {
      label: string;
      description: string;
      customLabel: string;
      customPlaceholder: string;
      customHelp: string;
    };
    allowedModels: {
      label: string;
      placeholder: string;
      description: string;
    };
  };
  actions: {
    allow: string;
    block: string;
  };
  presetClients: Record<string, string>;
  subClients: Record<string, string>;
  nSelected: string;
  limitRules: {
    addRule: string;
    title: string;
    description: string;
    cancel: string;
    confirm: string;
    fields: {
      type: {
        label: string;
        placeholder: string;
      };
      value: {
        label: string;
        placeholder: string;
      };
    };
    limit5h: {
      mode: {
        label: string;
        fixed: string;
        rolling: string;
        helperFixed: string;
        helperRolling: string;
      };
    };
    daily: {
      mode: {
        label: string;
        fixed: string;
        rolling: string;
        helperFixed: string;
        helperRolling: string;
      };
      time: {
        label: string;
        placeholder: string;
      };
    };
    limitTypes: {
      limitRpm: string;
      limit5h: string;
      limitDaily: string;
      limitWeekly: string;
      limitMonthly: string;
      limitTotal: string;
      limitSessions: string;
    };
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
    errors: {
      missingType: string;
      invalidValue: string;
      invalidTime: string;
    };
    overwriteHint: string;
    actions: {
      add: string;
      remove: string;
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
  const tLimitRules = useTranslations("dashboard.limitRules");
  const tUi = useTranslations("ui.tagInput");
  const tCommon = useTranslations("common");

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
          customHelp: t("userEditSection.fields.allowedClients.customHelp"),
        },
        blockedClients: {
          label: t("userEditSection.fields.blockedClients.label"),
          description: t("userEditSection.fields.blockedClients.description"),
          customLabel: t("userEditSection.fields.blockedClients.customLabel"),
          customPlaceholder: t("userEditSection.fields.blockedClients.customPlaceholder"),
          customHelp: t("userEditSection.fields.blockedClients.customHelp"),
        },
        allowedModels: {
          label: t("userEditSection.fields.allowedModels.label"),
          placeholder: t("userEditSection.fields.allowedModels.placeholder"),
          description: t("userEditSection.fields.allowedModels.description"),
        },
      },
      actions: {
        allow: t("userEditSection.actions.allow"),
        block: t("userEditSection.actions.block"),
      },
      presetClients: {
        "claude-code": t("userEditSection.presetClients.claude-code"),
        "gemini-cli": t("userEditSection.presetClients.gemini-cli"),
        "factory-cli": t("userEditSection.presetClients.factory-cli"),
        "codex-cli": t("userEditSection.presetClients.codex-cli"),
      },
      subClients: {
        all: t("userEditSection.subClients.all"),
        cli: t("userEditSection.subClients.cli"),
        vscode: t("userEditSection.subClients.vscode"),
        "sdk-ts": t("userEditSection.subClients.sdk-ts"),
        "sdk-py": t("userEditSection.subClients.sdk-py"),
        "cli-sdk": t("userEditSection.subClients.cli-sdk"),
        "gh-action": t("userEditSection.subClients.gh-action"),
        "codex-cli-core": t("userEditSection.subClients.codex-cli-core"),
        desktop: t("userEditSection.subClients.desktop"),
        exec: t("userEditSection.subClients.exec"),
      },
      nSelected: t("userEditSection.nSelected", { count: "{count}" }),
      limitRules: {
        addRule: tLimitRules("addRule"),
        title: tLimitRules("title"),
        description: tLimitRules("description"),
        cancel: tLimitRules("cancel"),
        confirm: tLimitRules("confirm"),
        fields: {
          type: {
            label: tLimitRules("fields.type.label"),
            placeholder: tLimitRules("fields.type.placeholder"),
          },
          value: {
            label: tLimitRules("fields.value.label"),
            placeholder: tLimitRules("fields.value.placeholder"),
          },
        },
        limit5h: {
          mode: {
            label: tLimitRules("limit5h.mode.label"),
            fixed: tLimitRules("limit5h.mode.fixed"),
            rolling: tLimitRules("limit5h.mode.rolling"),
            helperFixed: tLimitRules("limit5h.mode.helperFixed"),
            helperRolling: tLimitRules("limit5h.mode.helperRolling"),
          },
        },
        daily: {
          mode: {
            label: tLimitRules("daily.mode.label"),
            fixed: tLimitRules("daily.mode.fixed"),
            rolling: tLimitRules("daily.mode.rolling"),
            helperFixed: tLimitRules("daily.mode.helperFixed"),
            helperRolling: tLimitRules("daily.mode.helperRolling"),
          },
          time: {
            label: tLimitRules("daily.time.label"),
            placeholder: tLimitRules("daily.time.placeholder"),
          },
        },
        limitTypes: {
          limitRpm: tLimitRules("limitTypes.limitRpm"),
          limit5h: tLimitRules("limitTypes.limit5h"),
          limitDaily: tLimitRules("limitTypes.limitDaily"),
          limitWeekly: tLimitRules("limitTypes.limitWeekly"),
          limitMonthly: tLimitRules("limitTypes.limitMonthly"),
          limitTotal: tLimitRules("limitTypes.limitTotal"),
          limitSessions: tLimitRules("limitTypes.limitSessions"),
        },
        ruleTypes: {
          limitRpm: tLimitRules("ruleTypes.limitRpm"),
          limit5h: tLimitRules("ruleTypes.limit5h"),
          limitDaily: tLimitRules("ruleTypes.limitDaily"),
          limitWeekly: tLimitRules("ruleTypes.limitWeekly"),
          limitMonthly: tLimitRules("ruleTypes.limitMonthly"),
          limitTotal: tLimitRules("ruleTypes.limitTotal"),
          limitSessions: tLimitRules("ruleTypes.limitSessions"),
        },
        quickValues: {
          unlimited: tLimitRules("quickValues.unlimited"),
          "10": tLimitRules("quickValues.10"),
          "50": tLimitRules("quickValues.50"),
          "100": tLimitRules("quickValues.100"),
          "500": tLimitRules("quickValues.500"),
        },
        errors: {
          missingType: tLimitRules("errors.missingType"),
          invalidValue: tLimitRules("errors.invalidValue"),
          invalidTime: tLimitRules("errors.invalidTime"),
        },
        overwriteHint: tLimitRules("overwriteHint"),
        actions: {
          add: tLimitRules("confirmAdd"),
          remove: tCommon("remove"),
        },
      },
      quickExpire: {
        week: t("quickExpire.oneWeek"),
        month: t("quickExpire.oneMonth"),
        threeMonths: t("quickExpire.threeMonths"),
        year: t("quickExpire.oneYear"),
      },
    };
  }, [showProviderGroup, t, tCommon, tLimitRules, tUi]);
}
