/**
 * @vitest-environment happy-dom
 *
 * Regression: editing/toggling/deleting an error rule must refresh the list
 * immediately (router.refresh) instead of leaving stale data until a manual
 * page/cache refresh. Mirrors the behavior request-filters already has.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ErrorRule } from "@/repository/error-rules";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refreshMock = vi.fn();
const updateErrorRuleActionMock = vi.fn(async () => ({ ok: true }));
const deleteErrorRuleActionMock = vi.fn(async () => ({ ok: true }));
const createErrorRuleActionMock = vi.fn(async () => ({ ok: true }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useTimeZone: () => "UTC",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api-client/v1/actions/error-rules", () => ({
  updateErrorRuleAction: updateErrorRuleActionMock,
  deleteErrorRuleAction: deleteErrorRuleActionMock,
  createErrorRuleAction: createErrorRuleActionMock,
}));

// --- UI primitive stubs (Radix portals/providers are noise for this test) ---
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, "aria-label": ariaLabel }: any) => (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, type }: any) => (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogTrigger: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: any) => <label>{children}</label>,
}));

vi.mock("@/app/[locale]/settings/error-rules/_components/override-section", () => ({
  OverrideSection: () => null,
}));

vi.mock("@/app/[locale]/settings/error-rules/_components/regex-tester", () => ({
  RegexTester: () => null,
}));

const rule: ErrorRule = {
  id: 42,
  pattern: "boom",
  category: "prompt_limit",
  matchType: "contains",
  description: "test rule",
  overrideResponse: null,
  overrideStatusCode: null,
  isEnabled: true,
  isDefault: false,
  priority: 0,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
};

let container: HTMLDivElement;
let root: Root;

async function mount(element: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  vi.unstubAllGlobals();
});

describe("error rules list refresh after mutation", () => {
  test("toggling a rule refreshes the list", async () => {
    const { RuleListTable } = await import(
      "@/app/[locale]/settings/error-rules/_components/rule-list-table"
    );

    await mount(<RuleListTable rules={[rule]} />);

    const toggle = container.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();

    await act(async () => {
      toggle.click();
    });
    await flush();

    expect(updateErrorRuleActionMock).toHaveBeenCalledWith(42, { isEnabled: false });
    expect(refreshMock).toHaveBeenCalled();
  });

  test("deleting a rule refreshes the list", async () => {
    const { RuleListTable } = await import(
      "@/app/[locale]/settings/error-rules/_components/rule-list-table"
    );

    await mount(<RuleListTable rules={[rule]} />);

    const deleteButton = container
      .querySelector(".lucide-trash-2")
      ?.closest("button") as HTMLButtonElement;
    expect(deleteButton).toBeTruthy();

    await act(async () => {
      deleteButton.click();
    });
    await flush();

    expect(deleteErrorRuleActionMock).toHaveBeenCalledWith(42);
    expect(refreshMock).toHaveBeenCalled();
  });

  test("saving an edited rule refreshes the list", async () => {
    const { EditRuleDialog } = await import(
      "@/app/[locale]/settings/error-rules/_components/edit-rule-dialog"
    );

    await mount(<EditRuleDialog rule={rule} open={true} onOpenChange={vi.fn()} />);

    const form = container.querySelector("form") as HTMLFormElement;
    expect(form).toBeTruthy();

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(updateErrorRuleActionMock).toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });
});
