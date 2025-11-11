import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async ({ mode }) => {
  const { default: tsconfigPaths } = await import("vite-tsconfig-paths");
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tsconfigPaths()],
    css: {
      postcss: {
        plugins: [],
      },
    },
    resolve: {
      alias: {
        "server-only": new URL("./test/mocks/server-only.ts", import.meta.url).pathname,
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["**/*.{test,spec}.{ts,tsx}"],
      passWithNoTests: true,
      setupFiles: ["./test/setup.ts"],
      env,
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html"],
      },
    },
  };
});
