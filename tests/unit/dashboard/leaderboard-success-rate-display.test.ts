import { describe, expect, it } from "vitest";
import { getSuccessRateCellDisplay } from "@/app/[locale]/dashboard/leaderboard/_components/success-rate-display";

describe("getSuccessRateCellDisplay", () => {
  const t = (key: string) =>
    ({
      "columns.successRateUnavailable": "N/A",
      "columns.successRateBasisDisclosure": "no countable outcomes",
    })[key] ?? key;

  it("formats numeric success rate as percentage", () => {
    expect(getSuccessRateCellDisplay({ successRate: 0.875 }, t as never)).toEqual({
      label: "87.5%",
      title: undefined,
    });
  });

  it("formats redirected numeric success rate without an unavailable tooltip", () => {
    expect(
      getSuccessRateCellDisplay(
        {
          successRate: 0.875,
          basisDisclosureRequired: true,
        },
        t as never
      )
    ).toEqual({
      label: "87.5%",
      title: undefined,
    });
  });

  it("shows unavailable reason only when there are no countable outcomes", () => {
    expect(
      getSuccessRateCellDisplay(
        {
          successRate: null,
          basisDisclosureRequired: true,
          successRateUnavailableReason: "no_countable_outcomes",
        },
        t as never
      )
    ).toEqual({
      label: "N/A",
      title: "no countable outcomes",
    });
  });

  it("does not explain null success rate as redirected billing", () => {
    expect(
      getSuccessRateCellDisplay(
        {
          successRate: null,
          basisDisclosureRequired: true,
        },
        t as never
      )
    ).toEqual({
      label: "N/A",
      title: undefined,
    });
  });
});
