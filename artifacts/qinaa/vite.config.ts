import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const envDir = path.resolve(import.meta.dirname, "../..");

const replitPlugins =
  process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
    ? [
        await import("@replit/vite-plugin-cartographer").then((m) =>
          m.cartographer({
            root: path.resolve(import.meta.dirname, ".."),
          }),
        ),
        await import("@replit/vite-plugin-dev-banner").then((m) =>
          m.devBanner(),
        ),
      ]
    : [];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "VITE_");

  const supabaseUrl = env.VITE_SUPABASE_URL ?? "";
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      `[vite] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in ${envDir}/.env — Supabase auth will fail.`,
    );
  }

  const parsedPort = Number(env.VITE_DEV_PORT ?? process.env.VITE_DEV_PORT ?? 5173);
  const port = Number.isNaN(parsedPort) || parsedPort <= 0 ? 5173 : parsedPort;
  const basePath = env.BASE_PATH ?? process.env.BASE_PATH ?? "/";
  const apiProxyTarget =
    env.VITE_API_URL?.replace(/\/+$/, "") ??
    `http://localhost:${env.API_SERVER_PORT ?? process.env.API_SERVER_PORT ?? "3000"}`;

  return {
    base: basePath,
    envDir,
    envPrefix: "VITE_",
    // Explicitly embed Supabase env so the anon key is always in the client bundle.
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabaseAnonKey),
    },
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...replitPlugins,
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
