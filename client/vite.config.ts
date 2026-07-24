import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// BOFFO client — built static assets are hosted at the Catalyst client root.
// `base: "./"` makes asset URLs relative so they resolve at the deployed domain root.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Dev-only proxy: forward /server/* to the deployed Catalyst Development domain
  // so the client can call functions during `vite dev` without CORS.
  const functionHost =
    env.VITE_FUNCTION_HOST ||
    "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    base: "./",
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      proxy: {
        "/server": {
          target: functionHost,
          changeOrigin: true,
          secure: true,
          // Rewrite the Set-Cookie domain/path so the httpOnly session cookie
          // from the Catalyst domain is stored for localhost during dev.
          cookieDomainRewrite: "localhost",
          cookiePathRewrite: "/",
        },
      },
    },
  };
});
