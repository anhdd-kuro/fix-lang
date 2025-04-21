import * as path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
    ],
    coverage: {
      provider: "v8",
      enabled: true,
      include: ["./src/**/**"],
    },
    testTimeout: 1000 * 10,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  plugins: [],
});
