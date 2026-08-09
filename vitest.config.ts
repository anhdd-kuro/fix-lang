import * as path from "path";
import { defineConfig } from "vitest/config";

const RENDERER_TESTS = "./src/renderer/**/*.test.{ts,tsx,js}";

const sharedExclude = [
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
];

export default defineConfig({
  assetsInclude: ["**/*.html"],
  test: {
    globals: true,
    testTimeout: 1000 * 10,
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      enabled: false,
      include: ["./src/**/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["./src/**/*.test.{ts,tsx,js}"],
          includeSource: ["./src/**/*.test.{ts,js}"],
          exclude: [...sharedExclude, RENDERER_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: "renderer",
          environment: "jsdom",
          include: [RENDERER_TESTS],
          includeSource: ["./src/renderer/**/*.test.{ts,js}"],
          exclude: sharedExclude,
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "~": path.resolve(__dirname, "src"),
    },
  },
  plugins: [],
});
