"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Agentation } from "agentation";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useState } from "react";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        storageKey="claude-code-hub-theme"
        enableColorScheme
        disableTransitionOnChange
      >
        {children}
        {process.env.NODE_ENV === "development" && <Agentation />}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
