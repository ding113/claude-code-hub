import { useEffect, useRef, useState } from "react";

type StableIntersectionObserverInit = IntersectionObserverInit & {
  delay?: number;
  trackVisibility?: boolean;
};

function areNumberArraysEqual(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

function isThresholdEqual(
  a: StableIntersectionObserverInit["threshold"],
  b: StableIntersectionObserverInit["threshold"]
) {
  // IntersectionObserver 默认 threshold 为 0；undefined / 0 / [0] 语义等价。
  const aNormalized = a === undefined ? 0 : a;
  const bNormalized = b === undefined ? 0 : b;

  if (aNormalized === bNormalized) return true;

  const aArray = Array.isArray(aNormalized) ? aNormalized : undefined;
  const bArray = Array.isArray(bNormalized) ? bNormalized : undefined;

  if (aArray && bArray) return areNumberArraysEqual(aArray, bArray);
  if (aArray) return aArray.length === 1 && Object.is(aArray[0], bNormalized as number);
  if (bArray) return bArray.length === 1 && Object.is(bArray[0], aNormalized as number);

  return Object.is(aNormalized as number, bNormalized as number);
}

function areObserverOptionsEqual(
  a: StableIntersectionObserverInit,
  b: StableIntersectionObserverInit
) {
  // IntersectionObserver 默认 root 为 null（viewport）；undefined / null 语义等价。
  const rootA = a.root ?? null;
  const rootB = b.root ?? null;

  return (
    rootA === rootB &&
    a.rootMargin === b.rootMargin &&
    isThresholdEqual(a.threshold, b.threshold) &&
    a.trackVisibility === b.trackVisibility &&
    a.delay === b.delay
  );
}

function useStableIntersectionObserverOptions(options?: IntersectionObserverInit) {
  // 关键点：保持 `{ rootMargin: "200px", ...options }` 的语义不变；
  // 仅在字段值变化时才更新引用，避免 effect 依赖触发 observer 反复重建。
  const resolvedOptions: StableIntersectionObserverInit = { rootMargin: "200px", ...options };

  const stableOptionsRef = useRef(resolvedOptions);
  if (!areObserverOptionsEqual(stableOptionsRef.current, resolvedOptions)) {
    stableOptionsRef.current = resolvedOptions;
  }

  return stableOptionsRef.current;
}

/**
 * 仅在元素首次进入视窗（含 rootMargin 预取）后变为 true 的 Hook。
 *
 * - 用于将“按行/按卡片”的请求从挂载时触发，延迟到可视区域附近触发，避免首屏请求风暴。
 * - 在 test 环境或缺少 IntersectionObserver 时会直接视为可见，保证可预测性。
 */
export function useInViewOnce<T extends Element>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  const [isInView, setIsInView] = useState(false);
  const stableOptions = useStableIntersectionObserverOptions(options);

  useEffect(() => {
    if (isInView) return;
    const el = ref.current;
    if (!el) return;

    if (process.env.NODE_ENV === "test" || typeof IntersectionObserver === "undefined") {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry?.isIntersecting) {
        setIsInView(true);
        observer.disconnect();
      }
    }, stableOptions);

    observer.observe(el);
    return () => observer.disconnect();
  }, [isInView, stableOptions]);

  return { ref, isInView };
}
