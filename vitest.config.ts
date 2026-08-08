import * as path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  assetsInclude: ["**/*.html"],
  test: {
    environment: "jsdom",
    globals: true,
    includeSource: ["./src/**/*.test.{ts,js}"],
    exclude: [
      "node_modules",
      "e2e",
      "coverage",
      "dist",
      "build",
      "out",
      "resources",
      ".opencode",
      ".claude",
      "tmp",
      "**/node_modules/**",
    ],
    include: ["./src/**/*.test.{ts,tsx,js}"],
    coverage: {
      provider: "v8",
      enabled: true,
      include: ["./src/**/**"],
    },
    testTimeout: 1000 * 10,
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "~": path.resolve(__dirname, "src"),
    },
  },
  plugins: [],
});
