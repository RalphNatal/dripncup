import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Honours the `@/*` alias from tsconfig.json.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    // Excludes the Playwright suite added in Phase 11.
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
  },
});
