import { defineConfig } from "electron-vite";
import path from "path";

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      rollupOptions: {
        external: ["electron"],
        input: {
          main: path.resolve(__dirname, "src/main.ts")
        }
      }
    }
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: {
          preload: path.resolve(__dirname, "src/preload.ts")
        }
      }
    }
  },
  renderer: {
    root: path.resolve(__dirname),
    build: {
      outDir: "out/renderer",
      assetsDir: ".", // Place assets in the root of outDir
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "index.html")
        }
      }
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/renderer")
      }
    }
  }
});
