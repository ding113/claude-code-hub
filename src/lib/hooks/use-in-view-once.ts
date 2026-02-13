import { useEffect, useRef, useState } from "react";

/**
 * 仅在元素首次进入视窗（含 rootMargin 预取）后变为 true 的 Hook。
 *
 * - 用于将“按行/按卡片”的请求从挂载时触发，延迟到可视区域附近触发，避免首屏请求风暴。
 * - 在 test 环境或缺少 IntersectionObserver 时会直接视为可见，保证可预测性。
 */
export function useInViewOnce<T extends Element>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    if (isInView) return;
    const el = ref.current;
    if (!el) return;

    if (process.env.NODE_ENV === "test" || typeof IntersectionObserver === "undefined") {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px", ...options }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isInView, options]);

  return { ref, isInView };
}
