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
        external: ["electron"],
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
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
          translation: resolve(
            __dirname,
            "src/renderer/TranslationWindow/index.html",
          ),
          promptGen: resolve(
            __dirname,
            "src/renderer/PromptGenWindow/index.html",
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
