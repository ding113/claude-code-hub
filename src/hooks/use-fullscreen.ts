"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export interface FullscreenController {
  supported: boolean;
  isFullscreen: boolean;
  request: (element: HTMLElement | null) => Promise<void>;
  exit: () => Promise<void>;
}

function getFullscreenElement(): Element | null {
  return document.fullscreenElement ?? null;
}

export function useFullscreen(): FullscreenController {
  const supported = useMemo(() => {
    if (typeof document === "undefined") return false;
    return typeof document.exitFullscreen === "function";
  }, []);

  const [isFullscreen, setIsFullscreen] = useState(() => {
    if (typeof document === "undefined") return false;
    return Boolean(getFullscreenElement());
  });

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleChange = () => {
      setIsFullscreen(Boolean(getFullscreenElement()));
    };

    document.addEventListener("fullscreenchange", handleChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleChange);
    };
  }, []);

  const request = useCallback(async (element: HTMLElement | null) => {
    if (!element) return;
    if (typeof element.requestFullscreen !== "function") return;

    await element.requestFullscreen();
  }, []);

  const exit = useCallback(async () => {
    if (typeof document === "undefined") return;
    if (typeof document.exitFullscreen !== "function") return;
    if (!getFullscreenElement()) return;

    await document.exitFullscreen();
  }, []);

  return {
    supported,
    isFullscreen,
    request,
    exit,
  };
}
