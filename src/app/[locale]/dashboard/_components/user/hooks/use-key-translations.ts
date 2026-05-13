"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

export interface KeyEditTranslations {
  sections: {
    basicInfo: string;
    expireTime: string;
    limitRules: string;
    specialFeatures: string;
  };
  fields: {
    keyName: {
      label: string;
      placeholder: string;
    };
    balanceQueryPage: {
      label: string;
      description: string;
      descriptionEnabled: string;
      descriptionDisabled: string;
    };
    providerGroup: {
      label: string;
      placeholder: string;
      selectHint: string;
      editHint: string;
      allGroups: string;
      noGroupHint: string;
    };
    cacheTtl: {
      label: string;
      options: {
        inherit: string;
        "5m": string;
        "1h": string;
      };
    };
    enableStatus: {
      label: string;
      description: string;
    };
  };
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

/**
 * Hook to build key edit section translations.
 * Centralizes all translation key lookups for KeyEditSection.
 */
export function useKeyTranslations(): KeyEditTranslations {
  const t = useTranslations("dashboard.userManagement");
  const tLimitRules = useTranslations("dashboard.limitRules");
  const tCommon = useTranslations("common");

  return useMemo(() => {
    return {
      sections: {
        basicInfo: t("keyEditSection.sections.basicInfo"),
        expireTime: t("keyEditSection.sections.expireTime"),
        limitRules: t("keyEditSection.sections.limitRules"),
        specialFeatures: t("keyEditSection.sections.specialFeatures"),
      },
      fields: {
        keyName: {
          label: t("keyEditSection.fields.keyName.label"),
          placeholder: t("keyEditSection.fields.keyName.placeholder"),
        },
        balanceQueryPage: {
          label: t("keyEditSection.fields.balanceQueryPage.label"),
          description: t("keyEditSection.fields.balanceQueryPage.description"),
          descriptionEnabled: t("keyEditSection.fields.balanceQueryPage.descriptionEnabled"),
          descriptionDisabled: t("keyEditSection.fields.balanceQueryPage.descriptionDisabled"),
        },
        providerGroup: {
          label: t("keyEditSection.fields.providerGroup.label"),
          placeholder: t("keyEditSection.fields.providerGroup.placeholder"),
          selectHint: t("keyEditSection.fields.providerGroup.selectHint"),
          editHint: t("keyEditSection.fields.providerGroup.editHint"),
          allGroups: t("keyEditSection.fields.providerGroup.allGroups"),
          noGroupHint: t("keyEditSection.fields.providerGroup.noGroupHint"),
        },
        cacheTtl: {
          label: t("keyEditSection.fields.cacheTtl.label"),
          options: {
            inherit: t("keyEditSection.fields.cacheTtl.options.inherit"),
            "5m": t("keyEditSection.fields.cacheTtl.options.5m"),
            "1h": t("keyEditSection.fields.cacheTtl.options.1h"),
          },
        },
        enableStatus: {
          label: t("keyEditSection.fields.enableStatus.label"),
          description: t("keyEditSection.fields.enableStatus.description"),
        },
      },
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
  }, [t, tCommon, tLimitRules]);
}
