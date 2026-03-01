/**
 * @vitest-environment happy-dom
 */
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ColumnDef,
  LeaderboardTable,
} from "@/app/[locale]/dashboard/leaderboard/_components/leaderboard-table";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

type ChildRow = {
  model: string;
  totalRequests: number;
};

type ParentRow = {
  providerId: number;
  providerName: string;
  totalRequests: number;
  modelStats: ChildRow[];
};

type Row = ParentRow | ChildRow;

describe("LeaderboardTable expandable rows", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  function renderSimple(node: ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(node));
    return { container, root };
  }

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  it("renders sub rows inline (no nested table) and toggles on click", () => {
    const data: ParentRow[] = [
      {
        providerId: 1,
        providerName: "Provider A",
        totalRequests: 10,
        modelStats: [
          { model: "model-x", totalRequests: 6 },
          { model: "model-y", totalRequests: 4 },
        ],
      },
    ];

    const columns: ColumnDef<Row>[] = [
      {
        header: "name",
        cell: (row) => ("providerName" in row ? row.providerName : row.model),
      },
      {
        header: "requests",
        className: "text-right",
        cell: (row) => String(row.totalRequests),
      },
    ];

    const { container } = renderSimple(
      <LeaderboardTable<Row>
        data={data as Row[]}
        period="daily"
        columns={columns}
        getRowKey={(row) => ("providerId" in row ? row.providerId : row.model)}
        getSubRows={(row) => ("modelStats" in row ? row.modelStats : null)}
        getSubRowKey={(row) => ("model" in row ? row.model : row.providerId)}
      />
    );

    const findCellByText = (text: string) =>
      Array.from(container.querySelectorAll("td")).find((td) => td.textContent?.trim() === text) ??
      null;

    expect(findCellByText("Provider A")).toBeTruthy();
    expect(findCellByText("model-x")).toBeNull();

    const providerCell = findCellByText("Provider A")!;
    act(() => {
      providerCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const modelCell = findCellByText("model-x");
    expect(modelCell).toBeTruthy();

    const modelRow = modelCell!.closest("tr");
    expect(modelRow).toBeTruthy();
    expect(modelRow!.className).toContain("bg-muted/30");
  });
});
