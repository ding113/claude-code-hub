import { describe, expect, it } from "vitest";
import { getSuccessRateCellDisplay } from "@/app/[locale]/dashboard/leaderboard/_components/success-rate-display";

describe("getSuccessRateCellDisplay", () => {
  const t = (key: string) =>
    ({
      "columns.successRateUnavailable": "N/A",
      "columns.successRateBasisDisclosure": "basis disclosure",
    })[key] ?? key;

  it("formats numeric success rate as percentage", () => {
    expect(getSuccessRateCellDisplay({ successRate: 0.875 }, t as never)).toEqual({
      label: "87.5%",
      title: undefined,
    });
  });

  it("shows unavailable label with disclosure when basis diverges", () => {
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
      title: "basis disclosure",
    });
  });
});
