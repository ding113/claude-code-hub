"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { getProviderBalances } from "@/lib/api-client/v1/actions/provider-balance";
import { useInViewOnce } from "@/lib/hooks/use-in-view-once";
import { type ProviderBalanceEntry, ProviderBalanceStore } from "./balance-store";

/**
 * 自动更新间隔与服务端快照缓存时长一致：
 * 缓存未过期时服务端直接返回快照，过期后这次请求正好触发重新探测。
 */
export const PROVIDER_BALANCE_AUTO_REFRESH_MS = 10 * 60 * 1000;

const IDLE_ENTRY: ProviderBalanceEntry = Object.freeze({ snapshot: null, status: "idle" });
const NOOP_UNSUBSCRIBE = () => {};

const ProviderBalanceContext = createContext<ProviderBalanceStore | null>(null);

interface ProviderBalanceProviderProps {
  children: ReactNode;
  /** 注入点，测试中替换为受控实现 */
  store?: ProviderBalanceStore;
  autoRefreshMs?: number;
}

export function ProviderBalanceProvider({
  children,
  store,
  autoRefreshMs = PROVIDER_BALANCE_AUTO_REFRESH_MS,
}: ProviderBalanceProviderProps) {
  // 自建的 store 在同一个 effect 内创建和释放：StrictMode 的
  // setup - cleanup - setup 会重跑该 effect，复用同一个实例会拿到已经释放的 store。
  const [ownedStore, setOwnedStore] = useState<ProviderBalanceStore | null>(null);
  const activeStore = store ?? ownedStore;

  useEffect(() => {
    if (store) return;

    const created = new ProviderBalanceStore({ fetchBalances: getProviderBalances });
    setOwnedStore(created);

    return () => {
      created.dispose();
      setOwnedStore((current) => (current === created ? null : current));
    };
  }, [store]);

  useEffect(() => {
    if (!activeStore || autoRefreshMs <= 0) return;

    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void activeStore.revalidateTracked();
    }, autoRefreshMs);

    return () => clearInterval(timer);
  }, [activeStore, autoRefreshMs]);

  return (
    <ProviderBalanceContext.Provider value={activeStore}>
      {children}
    </ProviderBalanceContext.Provider>
  );
}

/**
 * 订阅单个供应商的余额。
 *
 * 返回的 ref 挂到行内元素上，元素接近视口时才登记查询，实现懒加载。
 */
export function useProviderBalance<T extends Element = HTMLDivElement>(providerId: number) {
  const store = useContext(ProviderBalanceContext);
  const { ref, isInView } = useInViewOnce<T>();

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      store ? store.subscribe(providerId, onStoreChange) : NOOP_UNSUBSCRIBE,
    [store, providerId]
  );
  const getEntry = useCallback(
    () => store?.getEntry(providerId) ?? IDLE_ENTRY,
    [store, providerId]
  );

  const entry = useSyncExternalStore(subscribe, getEntry, getEntry);

  useEffect(() => {
    if (!store || !isInView) return;
    store.request(providerId);
  }, [store, providerId, isInView]);

  const refresh = useCallback(async () => {
    await store?.refresh(providerId);
  }, [store, providerId]);

  return { ref, entry, refresh, available: store !== null };
}

/** 工具栏用的全局刷新控制 */
export function useProviderBalanceControls() {
  const store = useContext(ProviderBalanceContext);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      store ? store.subscribeGlobal(onStoreChange) : NOOP_UNSUBSCRIBE,
    [store]
  );
  const getIsRefreshing = useCallback(() => store?.isRefreshingAll() ?? false, [store]);

  const isRefreshingAll = useSyncExternalStore(subscribe, getIsRefreshing, getIsRefreshing);
  const refreshAll = useCallback(async () => {
    await store?.refreshAll();
  }, [store]);

  return { isRefreshingAll, refreshAll, available: store !== null };
}
