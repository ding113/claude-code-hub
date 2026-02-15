import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useInViewOnce", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalIntersectionObserver = globalThis.IntersectionObserver;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    globalThis.IntersectionObserver = originalIntersectionObserver;
    vi.resetModules();
  });

  it("在 test 环境下应直接视为可见，并避免创建 IntersectionObserver", async () => {
    process.env.NODE_ENV = "test";

    const ioCtor = vi.fn(function (this: any) {
      this.observe = vi.fn();
      this.unobserve = vi.fn();
      this.disconnect = vi.fn();
    });
    globalThis.IntersectionObserver = ioCtor as any;

    const { useEffect } = await import("react");
    const { useInViewOnce } = await import("@/lib/hooks/use-in-view-once");

    let lastValue = false;

    function Probe() {
      const { ref, isInView } = useInViewOnce<HTMLDivElement>();
      useEffect(() => {
        lastValue = isInView;
      }, [isInView]);

      return <div ref={ref} />;
    }

    const { unmount } = render(<Probe />);
    await act(async () => {});

    expect(lastValue).toBe(true);
    expect(ioCtor).not.toHaveBeenCalled();

    unmount();
  });

  it("应复用共享 observer，并在最后一个 target 解绑后释放资源", async () => {
    process.env.NODE_ENV = "development";

    type MockEntry = { target: Element; isIntersecting: boolean };

    class MockIntersectionObserver {
      static instances: MockIntersectionObserver[] = [];

      private readonly callback: (entries: MockEntry[]) => void;
      readonly observed = new Set<Element>();
      readonly observe = vi.fn((target: Element) => {
        this.observed.add(target);
      });
      readonly unobserve = vi.fn((target: Element) => {
        this.observed.delete(target);
      });
      readonly disconnect = vi.fn(() => {
        this.observed.clear();
      });

      constructor(callback: (entries: MockEntry[]) => void) {
        this.callback = callback;
        MockIntersectionObserver.instances.push(this);
      }

      trigger(target: Element, isIntersecting: boolean) {
        if (!this.observed.has(target)) return;
        this.callback([{ target, isIntersecting }]);
      }
    }

    globalThis.IntersectionObserver = MockIntersectionObserver as any;

    const { useCallback, useEffect } = await import("react");
    const { useInViewOnce } = await import("@/lib/hooks/use-in-view-once");

    let node1: Element | null = null;
    let node2: Element | null = null;
    let inView1 = false;
    let inView2 = false;

    function Probe(props: {
      onNode: (node: Element | null) => void;
      onView: (value: boolean) => void;
    }) {
      const { ref, isInView } = useInViewOnce<HTMLDivElement>();
      const { onNode, onView } = props;
      const mergedRef = useCallback(
        (node: HTMLDivElement | null) => {
          ref(node);
          onNode(node);
        },
        [onNode, ref]
      );

      useEffect(() => {
        onView(isInView);
      }, [isInView, onView]);

      return <div ref={mergedRef} />;
    }

    const { unmount } = render(
      <div>
        <Probe onNode={(node) => (node1 = node)} onView={(value) => (inView1 = value)} />
        <Probe onNode={(node) => (node2 = node)} onView={(value) => (inView2 = value)} />
      </div>
    );
    await act(async () => {});

    expect(MockIntersectionObserver.instances).toHaveLength(1);
    const io = MockIntersectionObserver.instances[0];
    expect(io.observe).toHaveBeenCalledTimes(2);

    expect(node1).not.toBeNull();
    expect(node2).not.toBeNull();

    act(() => {
      io.trigger(node1 as Element, true);
    });
    await act(async () => {});

    expect(inView1).toBe(true);
    expect(io.unobserve).toHaveBeenCalledWith(node1);
    expect(io.disconnect).not.toHaveBeenCalled();
    expect(io.observed.has(node1 as Element)).toBe(false);
    expect(io.observed.has(node2 as Element)).toBe(true);

    act(() => {
      io.trigger(node2 as Element, true);
    });
    await act(async () => {});

    expect(inView2).toBe(true);
    expect(io.unobserve).toHaveBeenCalledWith(node2);
    expect(io.disconnect).toHaveBeenCalledTimes(1);
    expect(io.observed.size).toBe(0);

    unmount();
  });
});
