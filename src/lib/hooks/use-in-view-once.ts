import { useCallback, useEffect, useMemo, useState } from "react";

type StableIntersectionObserverInit = IntersectionObserverInit & {
  delay?: number;
  trackVisibility?: boolean;
};

type ObserverTargetCallback = (entry: IntersectionObserverEntry) => void;
type ObserverRootKey = Element | Document;

const sharedObserversForNullRoot = new Map<string, SharedIntersectionObserver>();
const sharedObserversByRoot = new WeakMap<
  ObserverRootKey,
  Map<string, SharedIntersectionObserver>
>();

function getObserverOptionsKey(options: StableIntersectionObserverInit): string {
  const rootMargin = options.rootMargin ?? "0px";
  const threshold = options.threshold;
  const thresholdKey =
    threshold === undefined
      ? "0"
      : Array.isArray(threshold)
        ? threshold.join(",")
        : String(threshold);
  const trackVisibilityKey =
    options.trackVisibility === undefined ? "" : options.trackVisibility ? "1" : "0";
  const delayKey = options.delay === undefined ? "" : String(options.delay);
  return `${rootMargin}|${thresholdKey}|${trackVisibilityKey}|${delayKey}`;
}

function releaseSharedObserver(
  root: ObserverRootKey | null,
  optionsKey: string,
  observer: SharedIntersectionObserver
): void {
  if (root === null) {
    if (sharedObserversForNullRoot.get(optionsKey) === observer) {
      sharedObserversForNullRoot.delete(optionsKey);
    }
    return;
  }

  const pool = sharedObserversByRoot.get(root);
  if (!pool) return;
  if (pool.get(optionsKey) !== observer) return;

  pool.delete(optionsKey);
  if (pool.size === 0) {
    sharedObserversByRoot.delete(root);
  }
}

function getSharedObserver(options: StableIntersectionObserverInit): SharedIntersectionObserver {
  const root = options.root ?? null;
  const optionsKey = getObserverOptionsKey(options);

  if (root === null) {
    const existing = sharedObserversForNullRoot.get(optionsKey);
    if (existing) return existing;

    const observer = new SharedIntersectionObserver(root, optionsKey, options);
    sharedObserversForNullRoot.set(optionsKey, observer);
    return observer;
  }

  const rootKey = root as ObserverRootKey;
  const pool = sharedObserversByRoot.get(rootKey) ?? new Map<string, SharedIntersectionObserver>();
  if (!sharedObserversByRoot.has(rootKey)) {
    sharedObserversByRoot.set(rootKey, pool);
  }

  const existing = pool.get(optionsKey);
  if (existing) return existing;

  const observer = new SharedIntersectionObserver(rootKey, optionsKey, options);
  pool.set(optionsKey, observer);
  return observer;
}

class SharedIntersectionObserver {
  private readonly callbacksByTarget = new Map<Element, Set<ObserverTargetCallback>>();
  private readonly observer: IntersectionObserver;
  private disposed = false;

  constructor(
    private readonly root: ObserverRootKey | null,
    private readonly optionsKey: string,
    options: StableIntersectionObserverInit
  ) {
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const callbacks = this.callbacksByTarget.get(entry.target);
        if (!callbacks) continue;

        for (const callback of Array.from(callbacks)) {
          callback(entry);
        }
      }
    }, options);
  }

  observe(target: Element, callback: ObserverTargetCallback): () => void {
    if (this.disposed) {
      return () => {};
    }

    const callbacks = this.callbacksByTarget.get(target);
    if (!callbacks) {
      const next = new Set<ObserverTargetCallback>();
      next.add(callback);
      this.callbacksByTarget.set(target, next);
      this.observer.observe(target);
    } else {
      callbacks.add(callback);
    }

    return () => {
      this.unobserve(target, callback);
    };
  }

  private unobserve(target: Element, callback: ObserverTargetCallback) {
    const callbacks = this.callbacksByTarget.get(target);
    if (!callbacks) return;

    callbacks.delete(callback);
    if (callbacks.size > 0) return;

    this.callbacksByTarget.delete(target);

    try {
      this.observer.unobserve(target);
    } catch {
      // Ignore: target might already be gone/unobserved
    }

    if (this.callbacksByTarget.size === 0) {
      this.dispose();
    }
  }

  private dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    releaseSharedObserver(this.root, this.optionsKey, this);
  }
}

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
    const sharedObserver = getSharedObserver(stableOptions);
    let unsubscribe: (() => void) | null = null;

    const onEntry = (entry: IntersectionObserverEntry) => {
      if (disposed) return;
      if (!entry.isIntersecting) return;

      setIsInView(true);
      unsubscribe?.();
      unsubscribe = null;
    };

    unsubscribe = sharedObserver.observe(element, onEntry);
    return () => {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
    };
  }, [element, isInView, stableOptions]);

  return { ref, isInView };
}
