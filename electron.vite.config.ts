import { defineConfig } from "electron-vite";
import path, { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  main: {
    plugins: [tsconfigPaths()],
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
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [tailwindcss(), tsconfigPaths()],
    build: {
      outDir: "out/renderer",
      assetsDir: ".", // Place assets in the root of outDir
      rollupOptions: {},
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/renderer"),
      },
    },
  },
});
