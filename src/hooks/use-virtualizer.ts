"use client";

import type { PartialKeys, VirtualizerOptions } from "@tanstack/virtual-core";
import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  observeWindowOffset,
  observeWindowRect,
  Virtualizer,
  windowScroll,
} from "@tanstack/virtual-core";
import * as React from "react";

const useIsomorphicLayoutEffect =
  typeof document !== "undefined" ? React.useLayoutEffect : React.useEffect;

const scheduleRerender = (rerender: React.DispatchWithoutAction) => {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(rerender);
    return;
  }
  Promise.resolve().then(rerender);
};

function useVirtualizerBase<TScrollElement extends Element | Window, TItemElement extends Element>(
  options: VirtualizerOptions<TScrollElement, TItemElement>
): Virtualizer<TScrollElement, TItemElement> {
  const rerender = React.useReducer(() => ({}), {})[1];

  const resolvedOptions: VirtualizerOptions<TScrollElement, TItemElement> = {
    ...options,
    onChange: (instance, sync) => {
      if (sync) {
        scheduleRerender(rerender);
      } else {
        rerender();
      }
      options.onChange?.(instance, sync);
    },
  };

  const [instance] = React.useState(
    () => new Virtualizer<TScrollElement, TItemElement>(resolvedOptions)
  );

  instance.setOptions(resolvedOptions);

  useIsomorphicLayoutEffect(() => {
    return instance._didMount();
  }, [instance]);

  useIsomorphicLayoutEffect(() => {
    return instance._willUpdate();
  });

  return instance;
}

export function useVirtualizer<TScrollElement extends Element, TItemElement extends Element>(
  options: PartialKeys<
    VirtualizerOptions<TScrollElement, TItemElement>,
    "observeElementRect" | "observeElementOffset" | "scrollToFn"
  >
): Virtualizer<TScrollElement, TItemElement> {
  return useVirtualizerBase<TScrollElement, TItemElement>({
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
  });
}

export function useWindowVirtualizer<TItemElement extends Element>(
  options: PartialKeys<
    VirtualizerOptions<Window, TItemElement>,
    "getScrollElement" | "observeElementRect" | "observeElementOffset" | "scrollToFn"
  >
): Virtualizer<Window, TItemElement> {
  return useVirtualizerBase<Window, TItemElement>({
    getScrollElement: () => (typeof document !== "undefined" ? window : null),
    observeElementRect: observeWindowRect,
    observeElementOffset: observeWindowOffset,
    scrollToFn: windowScroll,
    initialOffset: () => (typeof document !== "undefined" ? window.scrollY : 0),
    ...options,
  });
}
