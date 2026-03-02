"use client";

import { createContext, useContext } from "react";
import {
  type CodeDisplayConfig,
  DEFAULT_CODE_DISPLAY_CONFIG,
} from "@/components/ui/code-display-config";

const CodeDisplayConfigContext = createContext<CodeDisplayConfig>(DEFAULT_CODE_DISPLAY_CONFIG);

export function CodeDisplayConfigProvider({
  value,
  children,
}: {
  value?: CodeDisplayConfig;
  children: React.ReactNode;
}) {
  return (
    <CodeDisplayConfigContext.Provider value={value ?? DEFAULT_CODE_DISPLAY_CONFIG}>
      {children}
    </CodeDisplayConfigContext.Provider>
  );
}

export function useCodeDisplayConfig(): CodeDisplayConfig {
  return useContext(CodeDisplayConfigContext);
}
