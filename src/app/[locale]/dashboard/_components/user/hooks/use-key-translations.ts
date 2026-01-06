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
    ruleTypes: {
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

/**
 * Hook to build key edit section translations.
 * Centralizes all translation key lookups for KeyEditSection.
 */
export function useKeyTranslations(): KeyEditTranslations {
  const t = useTranslations("dashboard.userManagement");

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
        addRule: t("limitRules.addRule"),
        ruleTypes: {
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
  }, [t]);
}
