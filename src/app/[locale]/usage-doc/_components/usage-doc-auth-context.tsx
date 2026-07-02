"use client";

import { createContext, type ReactNode, use, useMemo } from "react";

interface UsageDocAuthContextValue {
  isLoggedIn: boolean;
}

const UsageDocAuthContext = createContext<UsageDocAuthContextValue>({
  isLoggedIn: false,
});

// Security: HttpOnly cookies are invisible to document.cookie; session state must come from server.
export function UsageDocAuthProvider({
  isLoggedIn,
  children,
}: {
  isLoggedIn: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ isLoggedIn }), [isLoggedIn]);

  return <UsageDocAuthContext.Provider value={value}>{children}</UsageDocAuthContext.Provider>;
}

export function useUsageDocAuth(): UsageDocAuthContextValue {
  return use(UsageDocAuthContext);
}
