"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@/hooks/use-virtualizer";

interface UseVirtualizedInfiniteListOptions {
  itemCount: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown> | undefined;
  estimateSize: (index: number) => number;
  overscan?: number;
  loadMoreThreshold?: number;
  scrollTopThreshold?: number;
  getItemKey?: (index: number) => string | number;
}

export function useVirtualizedInfiniteList({
  itemCount,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  estimateSize,
  overscan = 10,
  loadMoreThreshold = 5,
  scrollTopThreshold = 500,
  getItemKey,
}: UseVirtualizedInfiniteListOptions) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  const getScrollElement = useCallback(() => parentRef.current, []);

  const rowVirtualizer = useVirtualizer({
    count: hasNextPage ? itemCount + 1 : itemCount,
    getScrollElement,
    estimateSize,
    overscan,
    getItemKey,
  });
  const rowVirtualizerRef = useRef(rowVirtualizer);
  rowVirtualizerRef.current = rowVirtualizer;

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItemIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    if (itemCount === 0) return;
    if (!hasNextPage) return;
    if (isFetchingNextPage) return;
    if (lastItemIndex >= itemCount - loadMoreThreshold) {
      void fetchNextPage();
    }
  }, [lastItemIndex, itemCount, hasNextPage, isFetchingNextPage, loadMoreThreshold, fetchNextPage]);

  const handleScroll = useCallback(() => {
    setShowScrollToTop((parentRef.current?.scrollTop ?? 0) > scrollTopThreshold);
  }, [scrollTopThreshold]);

  const scrollToTop = useCallback(() => {
    parentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const resetScrollPosition = useCallback(() => {
    rowVirtualizerRef.current.scrollToOffset?.(0);
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
    setShowScrollToTop(false);
  }, []);

  return {
    parentRef,
    rowVirtualizer,
    virtualItems,
    showScrollToTop,
    handleScroll,
    scrollToTop,
    resetScrollPosition,
  };
}
