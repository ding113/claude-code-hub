import { useCallback, useEffect, useMemo, useState } from "react";

type StableIntersectionObserverInit = IntersectionObserverInit & {
  delay?: number;
  trackVisibility?: boolean;
};

function useStableIntersectionObserverOptions(options?: IntersectionObserverInit) {
  const stableOptions = options as StableIntersectionObserverInit | undefined;

  // 关键点：保持 `{ rootMargin: "200px", ...options }` 的语义不变；
  // 并避免在渲染期间读写 ref，减少严格模式下的潜在隐患。
  const root = stableOptions?.root ?? null;
  const rootMargin = stableOptions?.rootMargin ?? "200px";
  const threshold = stableOptions?.threshold;
  const thresholdKey =
    threshold === undefined
      ? "0"
      : Array.isArray(threshold)
        ? threshold.join(",")
        : String(threshold);
  const stableThreshold = useMemo<StableIntersectionObserverInit["threshold"]>(() => {
    if (!thresholdKey) return 0;

    if (thresholdKey.includes(",")) {
      const values = thresholdKey
        .split(",")
        .map((value) => Number.parseFloat(value))
        .filter((value) => Number.isFinite(value));

      return values.length > 0 ? values : 0;
    }

    const value = Number.parseFloat(thresholdKey);
    return Number.isFinite(value) ? value : 0;
  }, [thresholdKey]);
  const trackVisibility = stableOptions?.trackVisibility;
  const delay = stableOptions?.delay;

  return useMemo<StableIntersectionObserverInit>(() => {
    const init: StableIntersectionObserverInit = { root, rootMargin, threshold: stableThreshold };
    if (trackVisibility !== undefined) init.trackVisibility = trackVisibility;
    if (delay !== undefined) init.delay = delay;
    return init;
  }, [delay, root, rootMargin, stableThreshold, trackVisibility]);
}

/**
 * 仅在元素首次进入视窗（含 rootMargin 预取）后变为 true 的 Hook。
 *
 * - 用于将“按行/按卡片”的请求从挂载时触发，延迟到可视区域附近触发，避免首屏请求风暴。
 * - 在 test 环境或缺少 IntersectionObserver 时会直接视为可见，保证可预测性。
 */
export function useInViewOnce<T extends Element>(options?: IntersectionObserverInit) {
  const [element, setElement] = useState<T | null>(null);
  const [isInView, setIsInView] = useState(false);
  const stableOptions = useStableIntersectionObserverOptions(options);

  const ref = useCallback((node: T | null) => {
    setElement(node);
  }, []);

  useEffect(() => {
    if (isInView) return;

    if (process.env.NODE_ENV === "test" || typeof IntersectionObserver === "undefined") {
      setIsInView(true);
      return;
    }

    if (!element) return;

    let disposed = false;
    const observer = new IntersectionObserver((entries) => {
      if (disposed) return;
      const entry = entries[0];
      if (entry?.isIntersecting) {
        setIsInView(true);
        observer.disconnect();
      }
    }, stableOptions);

    observer.observe(element);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [element, isInView, stableOptions]);

  return { ref, isInView };
}
