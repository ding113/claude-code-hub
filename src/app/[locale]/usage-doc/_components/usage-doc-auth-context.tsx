"use client";

import { createContext, type ReactNode, useContext } from "react";

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
  return (
    <UsageDocAuthContext.Provider value={{ isLoggedIn }}>{children}</UsageDocAuthContext.Provider>
  );
}

export function useUsageDocAuth(): UsageDocAuthContextValue {
  return useContext(UsageDocAuthContext);
}
