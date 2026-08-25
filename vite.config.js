import { defineConfig, loadEnv } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    appType: "spa",

    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
        "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
        "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
        "@services": fileURLToPath(new URL("./src/services", import.meta.url)),
        "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
        "@utils": fileURLToPath(new URL("./src/utils", import.meta.url)),
        "@styles": fileURLToPath(new URL("./src/styles", import.meta.url)),
        "@public": fileURLToPath(new URL("./public", import.meta.url))
      }
    },

    server: {
      host: true,
      port: 5173,
      strictPort: true,
      open: false
    },

    preview: {
      host: true,
      port: 4173,
      strictPort: true
    },

    build: {
      target: "es2022",
      outDir: "dist",
      assetsDir: "assets",
      sourcemap: false,
      emptyOutDir: true,

      rollupOptions: {
        output: {
          entryFileNames: "assets/js/[name]-[hash].js",
          chunkFileNames: "assets/js/[name]-[hash].js",
          assetFileNames: ({ names }) => {
            const fileName = names?.[0] ?? "";

            if (/\.css$/i.test(fileName)) {
              return "assets/css/[name]-[hash][extname]";
            }

            if (/\.(png|jpe?g|gif|svg|webp|avif|ico)$/i.test(fileName)) {
              return "assets/images/[name]-[hash][extname]";
            }

            if (/\.(woff2?|ttf|otf)$/i.test(fileName)) {
              return "assets/fonts/[name]-[hash][extname]";
            }

            return "assets/[name]-[hash][extname]";
          }
        }
      }
    },

    optimizeDeps: {
      include: [
        "@supabase/supabase-js",
        "@google/genai",
        "marked",
        "dompurify"
      ]
    },

    define: {
      __APP_VERSION__: JSON.stringify(
        env.npm_package_version || "2.0.0-beta.1"
      ),
      __BUILD_MODE__: JSON.stringify(mode)
    }
  };
});
