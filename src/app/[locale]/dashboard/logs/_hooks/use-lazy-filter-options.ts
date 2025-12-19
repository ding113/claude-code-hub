"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/actions/types";
import { getEndpointList, getModelList, getStatusCodeList } from "@/actions/usage-logs";

/**
 * 惰性加载 Hook 返回类型
 */
interface UseLazyFilterOptionsReturn<T> {
  /** 加载的数据 */
  data: T[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** 是否已加载完成 */
  isLoaded: boolean;
  /** 加载错误信息 */
  error: string | null;
  /** 手动触发加载 */
  load: () => Promise<void>;
  /** Select onOpenChange 事件处理器 */
  onOpenChange: (open: boolean) => void;
}

/**
 * 通用惰性加载 Hook 工厂函数
 * 消除重复代码，统一处理竞态条件和错误状态
 */
function createLazyFilterHook<T>(
  fetcher: () => Promise<ActionResult<T[]>>
): () => UseLazyFilterOptionsReturn<T> {
  return function useLazyFilter(): UseLazyFilterOptionsReturn<T> {
    const [data, setData] = useState<T[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 防止组件卸载后状态更新
    const mountedRef = useRef(true);
    // 防止竞态条件：追踪进行中的请求
    const inFlightRef = useRef<Promise<void> | null>(null);

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher 是工厂函数的闭包参数，在 hook 生命周期内永不改变
    const load = useCallback(async () => {
      // 如果已加载或有进行中的请求，跳过
      if (isLoaded || inFlightRef.current) return;

      const promise = (async () => {
        setIsLoading(true);
        setError(null);
        try {
          const result = await fetcher();
          if (!mountedRef.current) return;

          if (result.ok) {
            setData(result.data);
          } else {
            setError(result.error || "Failed to load data");
          }
        } catch (err) {
          if (!mountedRef.current) return;
          setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
          if (mountedRef.current) {
            setIsLoaded(true);
            setIsLoading(false);
          }
          inFlightRef.current = null;
        }
      })();

      inFlightRef.current = promise;
      return promise;
    }, [isLoaded]);

    const onOpenChange = useCallback(
      (open: boolean) => {
        if (open) load();
      },
      [load]
    );

    return { data, isLoading, isLoaded, error, load, onOpenChange };
  };
}

/**
 * 惰性加载 Models 列表
 * 用于 Model 筛选器下拉，展开时才加载数据
 */
export const useLazyModels: () => UseLazyFilterOptionsReturn<string> =
  createLazyFilterHook<string>(getModelList);

/**
 * 惰性加载 StatusCodes 列表
 * 用于 StatusCode 筛选器下拉，展开时才加载数据
 */
export const useLazyStatusCodes: () => UseLazyFilterOptionsReturn<number> =
  createLazyFilterHook<number>(getStatusCodeList);

/**
 * 惰性加载 Endpoints 列表
 * 用于 Endpoint 筛选器下拉，展开时才加载数据
 */
export const useLazyEndpoints: () => UseLazyFilterOptionsReturn<string> =
  createLazyFilterHook<string>(getEndpointList);
