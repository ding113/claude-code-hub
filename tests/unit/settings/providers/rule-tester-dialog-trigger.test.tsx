/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { RuleTesterDialogTrigger } from "@/app/[locale]/settings/providers/_components/rule-tester-dialog-trigger";

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");

  const DialogContext = React.createContext<{
    open: boolean;
    setOpen: (value: boolean) => void;
  } | null>(null);

  function Dialog({
    open = false,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }) {
    const [internalOpen, setInternalOpen] = React.useState(open);
    React.useEffect(() => setInternalOpen(open), [open]);
    const setOpen = (value: boolean) => {
      setInternalOpen(value);
      onOpenChange?.(value);
    };
    return (
      <DialogContext.Provider value={{ open: internalOpen, setOpen }}>
        {children}
      </DialogContext.Provider>
    );
  }

  function DialogTrigger({ children, asChild }: { children?: ReactNode; asChild?: boolean }) {
    const ctx = React.useContext(DialogContext);
    if (!ctx) return null;
    if (!asChild || !React.isValidElement(children)) {
      return <button onClick={() => ctx.setOpen(true)}>{children}</button>;
    }
    return React.cloneElement(children, {
      onClick: () => ctx.setOpen(true),
    });
  }

  function DialogContent({ children }: { children?: ReactNode }) {
    const ctx = React.useContext(DialogContext);
    if (!ctx?.open) return null;
    return <div data-testid="rule-tester-dialog">{children}</div>;
  }

  return {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("RuleTesterDialogTrigger", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  test("uses a compact trigger and opens dialog content on click", async () => {
    const { unmount } = render(
      <RuleTesterDialogTrigger title="Whitelist Tester" description="Check exact matching">
        <div>tester body</div>
      </RuleTesterDialogTrigger>
    );

    const trigger = document.querySelector(
      "[data-rule-tester-trigger]"
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="rule-tester-dialog"]')).toBeTruthy();
    expect(document.body.textContent || "").toContain("tester body");

    unmount();
  });
});
