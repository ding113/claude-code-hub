export interface SuccessRateDisplayRow {
  successRate: number | null;
  basisDisclosureRequired?: boolean;
  successRateUnavailableReason?: "no_countable_outcomes";
}

export interface SuccessRateDisplayValue {
  label: string;
  title?: string;
}

export function getSuccessRateCellDisplay(
  row: SuccessRateDisplayRow,
  t: (key: string) => string
): SuccessRateDisplayValue {
  if (typeof row.successRate === "number") {
    return {
      label: `${(Number(row.successRate) * 100).toFixed(1)}%`,
      title: undefined,
    };
  }

  return {
    label: t("columns.successRateUnavailable"),
    title:
      row.successRateUnavailableReason === "no_countable_outcomes"
        ? t("columns.successRateBasisDisclosure")
        : undefined,
  };
}
