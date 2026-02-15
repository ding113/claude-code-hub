import { useCallback, useEffect, useState } from "react";

type ObserverTargetCallback = (entry: IntersectionObserverEntry) => void;

const DEFAULT_OPTIONS: IntersectionObserverInit = {
  rootMargin: "200px",
  threshold: 0,
};

const sharedObservers = new Map<string, SharedIntersectionObserver>();

function getObserverOptionsKey(options: IntersectionObserverInit): string {
  const rootMargin = options.rootMargin ?? "0px";
  const threshold = options.threshold;
  const thresholdKey =
    threshold === undefined
      ? "0"
      : Array.isArray(threshold)
        ? threshold.join(",")
        : String(threshold);
  return `${rootMargin}|${thresholdKey}`;
}

class SharedIntersectionObserver {
  private readonly callbacksByTarget = new Map<Element, Set<ObserverTargetCallback>>();
  private readonly observer: IntersectionObserver;
  private readonly optionsKey: string;
  private disposed = false;

  constructor(optionsKey: string, options: IntersectionObserverInit) {
    this.optionsKey = optionsKey;
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
    sharedObservers.delete(this.optionsKey);
  }
}

function getSharedObserver(options: IntersectionObserverInit): SharedIntersectionObserver {
  const key = getObserverOptionsKey(options);
  const existing = sharedObservers.get(key);
  if (existing) return existing;

  const observer = new SharedIntersectionObserver(key, options);
  sharedObservers.set(key, observer);
  return observer;
}

/**
 * Returns true once an element enters the viewport (with 200px pre-fetch margin).
 *
 * Delays per-row/per-card requests until elements are near-visible, avoiding
 * request storms on mount. In test environments or without IntersectionObserver,
 * elements are treated as immediately visible.
 */
export function useInViewOnce<T extends Element>() {
  const [element, setElement] = useState<T | null>(null);
  const [isInView, setIsInView] = useState(false);

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
    const sharedObserver = getSharedObserver(DEFAULT_OPTIONS);
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
  }, [element, isInView]);

  return { ref, isInView };
}
