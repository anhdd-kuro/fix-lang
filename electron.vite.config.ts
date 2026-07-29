import path, { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import commonjs from "vite-plugin-commonjs";
import tsconfigPaths from "vite-tsconfig-paths";
import { parseFeatureFlags } from "./src/shared/features";

export const rendererPort = 5175;

/**
 * Build-time feature tags. Features are OPT-IN: without the tag the feature is
 * excluded from the build entirely.
 *   FIXLANG_FEATURES=promptgen bun run build   # env form (recommended)
 *   electron-vite build --promptgen            # CLI form
 */
const features = parseFeatureFlags({ argv: process.argv, env: process.env });

/** Injected into every bundle; read via `isPromptGenEnabled()`. */
const featureDefine = {
  __FEATURE_PROMPT_GEN__: JSON.stringify(features.promptGen),
};

const rendererInput = {
  main: resolve(__dirname, "src/renderer/MainWindow/index.html"),
  tray: resolve(__dirname, "src/renderer/TrayWindow/index.html"),
  correctionResult: resolve(
    __dirname,
    "src/renderer/CorrectionResultWindow/index.html",
  ),
  // Ask AI windows are unconditional (never feature-tagged) — unlike
  // PromptGen below, both entries always ship.
  askInput: resolve(__dirname, "src/renderer/AskInputWindow/index.html"),
  askResult: resolve(__dirname, "src/renderer/AskResultWindow/index.html"),
  // Omitted when the tag is off so no PromptGen bundle/html is emitted at all.
  ...(features.promptGen
    ? {
        promptGen: resolve(
          __dirname,
          "src/renderer/PromptGenWindow/index.html",
        ),
      }
    : {}),
};

export default defineConfig({
  main: {
    define: featureDefine,
    plugins: [tsconfigPaths(), tailwindcss()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        // Keep Electron 43's CommonJS runtime boundary intact.
        external: ["electron"],
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
        },
        // Emit CommonJS so `require("electron")` destructuring works at runtime.
        // Electron 43 (Node 24) fails on ESM named imports of lazy-getter APIs
        // like BrowserWindow. Use `.cjs` because package.json is `type: module`.
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "chunks/[name].cjs",
        },
      },
    },
  },
  preload: {
    define: featureDefine,
    plugins: [tsconfigPaths()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        external: ["electron"],
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
        },
        // Match the main process: CommonJS `.cjs` output (see note above).
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "chunks/[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    define: featureDefine,
    plugins: [tailwindcss(), tsconfigPaths(), commonjs()],
    server: {
      port: rendererPort,
      strictPort: false, // allow fallback if port in use
    },
    build: {
      outDir: "out/renderer",
      assetsDir: ".", // Place assets in the root of outDir
      rollupOptions: {
        input: rendererInput,
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/renderer"),
      },
    },
  },
});
