import path, { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import commonjs from "vite-plugin-commonjs";
import tsconfigPaths from "vite-tsconfig-paths";

export const rendererPort = 5175;

export default defineConfig({
  main: {
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
    plugins: [tailwindcss(), tsconfigPaths(), commonjs()],
    server: {
      port: rendererPort,
      strictPort: false, // allow fallback if port in use
    },
    build: {
      outDir: "out/renderer",
      assetsDir: ".", // Place assets in the root of outDir
      rollupOptions: {
        input: {
          main: resolve(__dirname, "src/renderer/MainWindow/index.html"),
          tray: resolve(__dirname, "src/renderer/TrayWindow/index.html"),
          promptGen: resolve(
            __dirname,
            "src/renderer/PromptGenWindow/index.html",
          ),
          correctionResult: resolve(
            __dirname,
            "src/renderer/CorrectionResultWindow/index.html",
          ),
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/renderer"),
      },
    },
  },
});
