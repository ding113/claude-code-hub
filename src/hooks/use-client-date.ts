"use client";

import { useSyncExternalStore } from "react";

let clientDateSnapshot: Date | null = null;

const subscribe = () => () => {};
const getServerSnapshot = () => null;
const getClientSnapshot = () => {
  if (clientDateSnapshot === null) {
    clientDateSnapshot = new Date();
  }
  return clientDateSnapshot;
};

export function useClientDate(): Date | null {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
